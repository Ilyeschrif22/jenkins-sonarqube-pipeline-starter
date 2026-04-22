# MERN CI/CD Pipeline — Full Setup & Troubleshooting Journal

A real-world walkthrough of every stage, error, and fix encountered while building
a Jenkins + SonarQube + Docker + Kubernetes pipeline for a MERN app.

---

## Final Pipeline Flow

```
GitHub (public repo)
        |
        v
Jenkins (Docker container)
        |
   Clone Repository           DONE
   Install Dependencies       DONE  (parallel: backend + frontend)
   SonarQube Analysis         DONE
   Docker Compose Build       DONE
   Push Images to DockerHub   DONE
   Deploy to Kubernetes       pending
```

---

## Environment

| Component         | How it runs                        |
|-------------------|------------------------------------|
| Jenkins           | Docker container                   |
| SonarQube         | Docker container                   |
| Docker network    | jenkins-net (custom bridge)        |
| Node.js in Jenkins| NodeJS plugin (auto-installed)     |
| SonarQube scanner | SonarQube Scanner plugin           |
| docker-compose    | Installed manually inside Jenkins  |

---

## Stage 1 — Jenkins and SonarQube Setup

### Start containers on a shared network

```bash
# Create shared network first
docker network create jenkins-net

# Start SonarQube
docker run -d \
  --name sonarqube \
  --network jenkins-net \
  -p 9000:9000 \
  sonarqube:latest

# Start Jenkins with Docker socket mounted
docker run -d \
  --name jenkins \
  --network jenkins-net \
  -p 8080:8080 -p 50000:50000 \
  -v jenkins_home:/var/jenkins_home \
  -v /var/run/docker.sock:/var/run/docker.sock \
  jenkins/jenkins:lts
```

The Docker socket mount is required so Jenkins can run docker commands on the host.
The shared network allows Jenkins to reach SonarQube by container name.

### Install Docker and docker-compose inside Jenkins

```bash
docker exec -it --user root jenkins bash

apt-get update && apt-get install -y docker.io docker-compose

docker --version
docker-compose --version

exit
```

### Fix Docker socket permissions

```bash
sudo chmod 666 /var/run/docker.sock
```

Or permanently via group membership:

```bash
docker exec -it --user root jenkins bash
usermod -aG docker jenkins
chmod 666 /var/run/docker.sock
exit
docker restart jenkins
```

---

## Stage 2 — Jenkins Configuration

### Required plugins

Install from Manage Jenkins -> Plugins -> Available plugins:

| Plugin               | Purpose                                        |
|----------------------|------------------------------------------------|
| NodeJS               | Auto-install Node.js and make npm available    |
| SonarQube Scanner    | Run sonar-scanner without manual CLI install   |
| Docker Pipeline      | Build and push Docker images                   |
| Git                  | Clone from GitHub                              |
| Pipeline             | Run Jenkinsfile pipelines                      |

### Configure NodeJS tool

Manage Jenkins -> Tools -> NodeJS installations -> Add NodeJS

```
Name:                  NodeJS-18
Install automatically: yes
Version:               18.x.x
```

The name must match the Jenkinsfile exactly:

```groovy
tools {
    nodejs 'NodeJS-18'
}
```

### Configure SonarQube Scanner tool

Manage Jenkins -> Tools -> SonarQube Scanner installations -> Add SonarQube Scanner

```
Name:                  sonarqube
Install automatically: yes
Version:               SonarQube Scanner 8.x
```

### Configure SonarQube server

Manage Jenkins -> System -> SonarQube servers

Check the Environment variables checkbox, then add:

```
Name:       sonarqube
Server URL: http://sonarqube:9000
Token:      sonar-token
```

The URL must use the container name, not localhost. They are on the same Docker
network so Jenkins resolves sonarqube by name.

### Add credentials

Manage Jenkins -> Credentials -> Global -> Add Credentials

| ID           | Kind                  | Value                              |
|--------------|-----------------------|------------------------------------|
| dockerhub    | Username with password| DockerHub username + access token  |
| sonar-token  | Secret text           | SonarQube user token               |

GitHub credentials are not needed for a public repo.

### Create a DockerHub access token

DockerHub does not accept Gmail passwords for API access.
A personal access token is required.

1. Go to https://hub.docker.com/settings/security
2. Click Personal access tokens -> Generate new token
3. Name: jenkins, Permission: Read and Write
4. Copy the token
5. Paste it as the Password in the dockerhub Jenkins credential

---

## Stage 3 — Repository Structure

```
devops-pipeline-starter/
|-- backend/
|   |-- app.js              Express app exported without listen()
|   |-- server.js           calls app.listen(), used by Docker
|   |-- package.json
|   `-- Dockerfile
|-- frontend/
|   |-- src/
|   |-- package.json
|   `-- Dockerfile
|-- docker-compose.yml
|-- sonar-project.properties
`-- Jenkinsfile
```

### Why app.js and server.js are separate

app.js exports the Express app without starting it.
server.js imports it and calls app.listen().
This pattern is required so tests can import the app without binding a port.
Supertest starts its own server on a random port during tests.

---

## Stage 4 — Config Files

### docker-compose.yml

```yaml
version: '3.8'

services:
  frontend:
    build:
      context: ./frontend
      dockerfile: Dockerfile
    container_name: mern-frontend
    ports:
      - "3000:80"
    depends_on:
      - backend
    networks:
      - mern-net

  backend:
    build:
      context: ./backend
      dockerfile: Dockerfile
    container_name: mern-backend
    ports:
      - "5000:5000"
    environment:
      - PORT=5000
    networks:
      - mern-net

networks:
  mern-net:
    driver: bridge
```

### sonar-project.properties

```properties
sonar.projectKey=mern-app
sonar.projectName=MERN App
sonar.projectVersion=1.0
sonar.sources=frontend/src,backend
sonar.exclusions=**/node_modules/**,**/build/**,**/coverage/**
sonar.sourceEncoding=UTF-8
```

### Jenkinsfile

```groovy
pipeline {
    agent any

    tools {
        nodejs 'NodeJS-18'
    }

    environment {
        DOCKERHUB_USER = 'ilyeschrif21'
        IMAGE_BACKEND  = "${DOCKERHUB_USER}/mern-backend"
        IMAGE_FRONTEND = "${DOCKERHUB_USER}/mern-frontend"
    }

    stages {

        stage('Clone Repository') {
            steps {
                git branch: 'main',
                    url: 'https://github.com/Ilyeschrif22/devops-pipeline-starter.git'
            }
        }

        stage('Install Dependencies') {
            parallel {
                stage('Backend deps') {
                    steps {
                        dir('backend') { sh 'npm install' }
                    }
                }
                stage('Frontend deps') {
                    steps {
                        dir('frontend') { sh 'npm install' }
                    }
                }
            }
        }

        stage('SonarQube Analysis') {
            steps {
                withSonarQubeEnv('sonarqube') {
                    sh "${tool 'sonarqube'}/bin/sonar-scanner"
                }
            }
        }

        stage('Docker Compose Build') {
            steps {
                sh 'docker-compose build'
            }
        }

        stage('Push Images to DockerHub') {
            steps {
                withCredentials([usernamePassword(
                    credentialsId: 'dockerhub',
                    usernameVariable: 'DOCKER_USER',
                    passwordVariable: 'DOCKER_PASS'
                )]) {
                    sh 'echo $DOCKER_PASS | docker login -u $DOCKER_USER --password-stdin'

                    sh "docker tag mern-pipeline-frontend ${IMAGE_FRONTEND}:${BUILD_NUMBER}"
                    sh "docker tag mern-pipeline-frontend ${IMAGE_FRONTEND}:latest"
                    sh "docker tag mern-pipeline-backend  ${IMAGE_BACKEND}:${BUILD_NUMBER}"
                    sh "docker tag mern-pipeline-backend  ${IMAGE_BACKEND}:latest"

                    sh "docker push ${IMAGE_FRONTEND}:${BUILD_NUMBER}"
                    sh "docker push ${IMAGE_FRONTEND}:latest"
                    sh "docker push ${IMAGE_BACKEND}:${BUILD_NUMBER}"
                    sh "docker push ${IMAGE_BACKEND}:latest"
                }
            }
        }

        stage('Deploy to Kubernetes') {
            steps {
                sh 'kubectl apply -f k8s/'
                sh 'kubectl rollout restart deployment/backend'
                sh 'kubectl rollout restart deployment/frontend'
            }
        }

    }

    post {
        always  { echo 'Pipeline finished.' }
        success { echo 'All stages passed. Deployment complete.' }
        failure { echo 'Pipeline failed — check the stage logs above.' }
    }
}
```

---

## Errors Encountered and Fixes

### Wrong repo name in Jenkins config

Cause: Jenkins pipeline config and Jenkinsfile pointed to
jenkins-sonarqube-pipeline-starter but the actual repo was devops-pipeline-starter.

Fix: Update the Repository URL in both Jenkins pipeline config and the Jenkinsfile
to match the actual repo name.

---

### npm: not found

Cause: Node.js was not installed in the Jenkins container.

Fix: Install the NodeJS plugin and configure it in Manage Jenkins -> Tools.
Add the tools block to the Jenkinsfile:

```groovy
tools {
    nodejs 'NodeJS-18'
}
```

---

### npm ci fails — no package-lock.json

Cause: npm ci requires a lockfile. None existed in the repo.

Fix: Changed npm ci to npm install in the Jenkinsfile. Works without a lockfile.

---

### no such file or directory: backend/package.json

Cause: backend/ and frontend/ folders did not exist at the repo root.
They were nested inside a subfolder.

Fix: Move both folders to the root of the repo and push.

---

### Tool type nodejs does not have an install of NodeJS-18 configured

Cause: The name in Manage Jenkins -> Tools did not match the Jenkinsfile.

Fix: Either rename the tool in Jenkins Tools to NodeJS-18 or update the
Jenkinsfile to use whatever name was configured. They must match exactly,
including capitalisation.

---

### sonar-scanner: not found

Cause: The SonarQube Scanner CLI was not installed in the Jenkins container.
The SonarQube Scanner for Jenkins plugin was installed but not the CLI tool.

Fix: Use withSonarQubeEnv and the tool() function so Jenkins downloads and
manages the scanner automatically:

```groovy
withSonarQubeEnv('sonarqube') {
    sh "${tool 'sonarqube'}/bin/sonar-scanner"
}
```

---

### Failed to query server version — null

Cause: Jenkins was on the bridge network while SonarQube was on jenkins-net.
They could not reach each other by container name.

Fix:

```bash
docker network connect jenkins-net jenkins
docker exec jenkins curl http://sonarqube:9000
```

---

### SonarQube server name was docker ps -a

Cause: The Name field in Manage Jenkins -> System -> SonarQube servers was
accidentally set to a shell command instead of a name.

Fix: Set Name to sonarqube and Server URL to http://sonarqube:9000.

---

### You must define sonar.projectKey

Cause: sonar-project.properties was missing from the repo root.

Fix: Add the file to the repo root with at minimum:

```properties
sonar.projectKey=mern-app
sonar.sources=frontend/src,backend
```

---

### docker: not found inside Jenkins

Cause: Jenkins container was started without the Docker socket mounted and
without docker installed inside.

Fix: Recreate Jenkins with the socket mounted and install docker inside:

```bash
docker stop jenkins && docker rm jenkins

docker run -d \
  --name jenkins \
  --network jenkins-net \
  -p 8080:8080 -p 50000:50000 \
  -v jenkins_home:/var/jenkins_home \
  -v /var/run/docker.sock:/var/run/docker.sock \
  jenkins/jenkins:lts

docker exec -it --user root jenkins bash
apt-get update && apt-get install -y docker.io
exit

sudo chmod 666 /var/run/docker.sock
```

---

### docker: compose is not a docker command

Cause: The docker.io package installed inside Jenkins was an older version
that does not include the compose subcommand (V2).

Fix: Install docker-compose (V1) separately:

```bash
docker exec -it --user root jenkins bash
apt-get install -y docker-compose
exit
```

Then use docker-compose build instead of docker compose build in the Jenkinsfile.

---

### No such property: DOCKER_CREDS_PSW

Cause: Using credentials() in the environment block does not reliably expose
_PSW and _USR suffixes in all Jenkins versions.

Fix: Use withCredentials with usernamePassword binding in the stage instead:

```groovy
withCredentials([usernamePassword(
    credentialsId: 'dockerhub',
    usernameVariable: 'DOCKER_USER',
    passwordVariable: 'DOCKER_PASS'
)]) {
    sh 'echo $DOCKER_PASS | docker login -u $DOCKER_USER --password-stdin'
}
```

---

### No such image: mern-frontend:latest

Cause: docker-compose prefixes built image names with the workspace folder name.
The workspace was mern-pipeline so images were named mern-pipeline-frontend
and mern-pipeline-backend, not mern-frontend.

Fix: Use the correct prefixed names in the tag commands:

```groovy
sh "docker tag mern-pipeline-frontend ${IMAGE_FRONTEND}:latest"
sh "docker tag mern-pipeline-backend  ${IMAGE_BACKEND}:latest"
```

---

### DockerHub login fails — Gmail password not accepted

Cause: DockerHub does not accept account passwords for API/CLI authentication.
A personal access token is required.

Fix:
1. Go to https://hub.docker.com/settings/security
2. Generate a new access token with Read and Write permission
3. Use the token as the password in the dockerhub Jenkins credential

---

## Stage Progress

| Stage                  | Status  | Main issue encountered                        |
|------------------------|---------|-----------------------------------------------|
| Clone Repository       | DONE    | Wrong repo name in URL                        |
| Install Dependencies   | DONE    | npm not found, npm ci without lockfile        |
| SonarQube Analysis     | DONE    | Scanner not found, wrong network, missing key |
| Docker Compose Build   | DONE    | docker not found, compose V1 vs V2            |
| Push Images to DockerHub| DONE   | Bad credentials binding, wrong image names    |
| Deploy to Kubernetes   | pending |                                               |

---

## Next Step — Kubernetes Deploy

For the Deploy to Kubernetes stage to work, kubectl must be installed inside
Jenkins and configured to point at your cluster.

```bash
docker exec -it --user root jenkins bash

apt-get install -y kubectl

# Copy kubeconfig from your machine into the container
exit

docker cp ~/.kube/config jenkins:/var/jenkins_home/.kube/config
```

---

*Student DevOps project — MERN stack CI/CD pipeline with Jenkins, SonarQube, Docker, and Kubernetes.*
