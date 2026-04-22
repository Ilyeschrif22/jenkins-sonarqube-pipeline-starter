# MERN CI/CD Pipeline — Full Setup & Troubleshooting Journal

## Before Every Build — Startup Checklist

Every time you restart your machine or the containers, run these commands
in order before triggering a Jenkins build. Skipping any of these is the
most common cause of pipeline failures.

```bash
# 1. Fix Docker socket permissions (required after every reboot)
sudo chmod 666 /var/run/docker.sock

# 2. Start Jenkins if not running
docker start jenkins

# 3. Start SonarQube if not running
docker start sonarqube

# 4. Start Minikube if not running
minikube start --driver=docker

# 5. Make sure Jenkins is on all required networks
docker network connect jenkins-net jenkins 2>/dev/null || true
docker network connect minikube jenkins 2>/dev/null || true

# 6. Verify everything is reachable from Jenkins
docker exec jenkins curl -s http://sonarqube:9000 | grep -q SonarQube && echo "SonarQube OK"
docker exec jenkins kubectl get nodes
```

You should see SonarQube OK and the minikube node in Ready status before
clicking Build Now.


## Final Pipeline Flow

```
GitHub (public repo)
        |
        v
Jenkins (Docker container)
        |
   Clone Repository            DONE
   Install Dependencies        DONE  (parallel: backend + frontend)
   SonarQube Analysis          DONE
   Docker Compose Build        DONE
   Push Images to DockerHub    DONE
   Deploy to Kubernetes        DONE
```


## Environment

| Component          | How it runs                        |
|--------------------|------------------------------------|
| Jenkins            | Docker container                   |
| SonarQube          | Docker container                   |
| Minikube           | Docker container (local cluster)   |
| Docker network     | jenkins-net and minikube           |
| Node.js in Jenkins | NodeJS plugin (auto-installed)     |
| SonarQube scanner  | SonarQube Scanner plugin           |
| docker-compose     | Installed manually inside Jenkins  |
| kubectl            | Installed manually inside Jenkins  |


## One-Time Setup — Do This Once

### 1. Create the shared network

```bash
docker network create jenkins-net
```

### 2. Start SonarQube

```bash
docker run -d \
  --name sonarqube \
  --network jenkins-net \
  -p 9000:9000 \
  sonarqube:latest
```

### 3. Start Jenkins with Docker socket mounted

```bash
docker run -d \
  --name jenkins \
  --network jenkins-net \
  -p 8080:8080 -p 50000:50000 \
  -v jenkins_home:/var/jenkins_home \
  -v /var/run/docker.sock:/var/run/docker.sock \
  jenkins/jenkins:lts
```

The Docker socket mount is required so Jenkins can run docker commands on the host.
Without it you get: permission denied on /var/run/docker.sock

### 4. Fix socket permissions

```bash
sudo chmod 666 /var/run/docker.sock
```

This must be re-run after every reboot because permissions reset.

### 5. Install tools inside Jenkins

```bash
docker exec -it --user root jenkins bash

apt-get update && apt-get install -y docker.io docker-compose curl

# Install kubectl
curl -LO "https://dl.k8s.io/release/$(curl -s https://dl.k8s.io/release/stable.txt)/bin/linux/amd64/kubectl"
chmod +x kubectl
mv kubectl /usr/local/bin/

# Verify
docker --version
docker-compose --version
kubectl version --client

exit
```

### 6. Start Minikube

```bash
minikube start --driver=docker
kubectl get nodes   # wait until STATUS shows Ready
```

### 7. Connect Jenkins to Minikube network

```bash
docker network connect minikube jenkins
```

### 8. Copy Minikube credentials into Jenkins

```bash
# Create dirs inside Jenkins
docker exec -it --user root jenkins bash
mkdir -p /var/jenkins_home/.kube
mkdir -p /home/user/.minikube/profiles/minikube
exit

# Copy kubeconfig and certs
docker cp ~/.kube/config jenkins:/var/jenkins_home/.kube/config
docker cp ~/.minikube/ca.crt jenkins:/home/user/.minikube/ca.crt
docker cp ~/.minikube/profiles/minikube/client.crt jenkins:/home/user/.minikube/profiles/minikube/client.crt
docker cp ~/.minikube/profiles/minikube/client.key jenkins:/home/user/.minikube/profiles/minikube/client.key

# Verify
docker exec jenkins kubectl get nodes
```

## Jenkins Configuration

### Required plugins

Install from Manage Jenkins -> Plugins -> Available plugins:

| Plugin             | Purpose                                     |
|--------------------|---------------------------------------------|
| NodeJS             | Auto-install Node.js and make npm available |
| SonarQube Scanner  | Run sonar-scanner without manual CLI        |
| Docker Pipeline    | Build and push Docker images                |
| Git                | Clone from GitHub                           |
| Pipeline           | Run Jenkinsfile pipelines                   |

### Configure NodeJS tool

Manage Jenkins -> Tools -> NodeJS installations -> Add NodeJS

```
Name:                  NodeJS-18
Install automatically: yes
Version:               18.x.x
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

Use the container name, not localhost. Jenkins resolves sonarqube by name
because both containers are on jenkins-net.

### Add credentials

Manage Jenkins -> Credentials -> Global -> Add Credentials

| ID          | Kind                   | Value                             |
|-------------|------------------------|-----------------------------------|
| dockerhub   | Username with password | DockerHub username + access token |
| sonar-token | Secret text            | SonarQube user token              |

GitHub credentials are not needed for a public repo.

### Create a DockerHub access token

DockerHub does not accept account passwords for CLI authentication.

1. Go to https://hub.docker.com/settings/security
2. Personal access tokens -> Generate new token
3. Name: jenkins, Permission: Read and Write
4. Copy the token and paste it as the Password in the dockerhub Jenkins credential

### Create SonarQube token

1. Open http://localhost:9000
2. Login with admin / admin (change on first login)
3. Administration -> Security -> Users -> admin -> Tokens
4. Generate a token and copy it
5. Add it to Jenkins as a Secret text credential with ID sonar-token


## Repository Structure

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
|-- k8s/
|   |-- backend-deployment.yaml
|   `-- frontend-deployment.yaml
|-- docker-compose.yml
|-- sonar-project.properties
`-- Jenkinsfile
```


## Config Files

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

### k8s/backend-deployment.yaml

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: backend
spec:
  replicas: 1
  selector:
    matchLabels:
      app: backend
  template:
    metadata:
      labels:
        app: backend
    spec:
      containers:
      - name: backend
        image: ilyeschrif21/mern-backend:latest
        ports:
        - containerPort: 5000
---
apiVersion: v1
kind: Service
metadata:
  name: backend-service
spec:
  type: ClusterIP
  selector:
    app: backend
  ports:
  - port: 5000
    targetPort: 5000
```

### k8s/frontend-deployment.yaml

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: frontend
spec:
  replicas: 1
  selector:
    matchLabels:
      app: frontend
  template:
    metadata:
      labels:
        app: frontend
    spec:
      containers:
      - name: frontend
        image: ilyeschrif21/mern-frontend:latest
        ports:
        - containerPort: 80
---
apiVersion: v1
kind: Service
metadata:
  name: frontend-service
spec:
  type: NodePort
  selector:
    app: frontend
  ports:
  - port: 80
    targetPort: 80
    nodePort: 30000
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

## Errors Encountered and Fixes

### permission denied on /var/run/docker.sock

Cause: Docker socket permissions reset after a container restart or machine reboot.

Fix:
```bash
sudo chmod 666 /var/run/docker.sock
```

This must be run every time the machine restarts.


### Wrong repo name in Jenkins config

Cause: Jenkins pipeline config pointed to jenkins-sonarqube-pipeline-starter
but the actual repo was devops-pipeline-starter.

Fix: Update the Repository URL in Jenkins pipeline config and in the Jenkinsfile.


### npm: not found

Cause: Node.js was not installed in the Jenkins container.

Fix: Install the NodeJS plugin and configure it in Manage Jenkins -> Tools.
Add the tools block to the Jenkinsfile:

```groovy
tools {
    nodejs 'NodeJS-18'
}
```


### npm ci fails — no package-lock.json

Cause: npm ci requires a lockfile. None existed in the repo.

Fix: Use npm install instead of npm ci in the Jenkinsfile.


### no such file or directory: backend/package.json

Cause: backend/ and frontend/ folders were missing from the repo root.

Fix: Make sure both folders exist at the root with their own package.json files.


### Tool type nodejs does not have an install of NodeJS-18 configured

Cause: The name in Manage Jenkins -> Tools did not match the Jenkinsfile.

Fix: The name in Tools and the Jenkinsfile must match exactly including capitalisation.


### sonar-scanner: not found

Cause: The SonarQube Scanner CLI was not installed. The plugin was installed
but not configured as a tool.

Fix: Configure the scanner in Manage Jenkins -> Tools then use:

```groovy
withSonarQubeEnv('sonarqube') {
    sh "${tool 'sonarqube'}/bin/sonar-scanner"
}
```


### Failed to query SonarQube server — null

Cause: Jenkins was on the bridge network, SonarQube was on jenkins-net.

Fix:
```bash
docker network connect jenkins-net jenkins
```


### SonarQube server Name was set to docker ps -a

Cause: The Name field in Manage Jenkins -> System -> SonarQube servers was
accidentally set to a shell command.

Fix: Set Name to sonarqube and Server URL to http://sonarqube:9000.


### You must define sonar.projectKey

Cause: sonar-project.properties was missing from the repo root.

Fix: Add the file with at minimum:
```properties
sonar.projectKey=mern-app
sonar.sources=frontend/src,backend
```

### docker: not found inside Jenkins

Cause: Jenkins was recreated without the socket mounted and without docker installed.

Fix:
```bash
docker exec -it --user root jenkins bash
apt-get update && apt-get install -y docker.io
exit
sudo chmod 666 /var/run/docker.sock
```


### docker: compose is not a docker command

Cause: The docker.io version installed does not include the compose subcommand (V2).

Fix: Install docker-compose separately and use docker-compose build in the Jenkinsfile:
```bash
docker exec -it --user root jenkins bash
apt-get install -y docker-compose
exit
```


### No such property: DOCKER_CREDS_PSW

Cause: credentials() in the environment block does not reliably expose _PSW and _USR.

Fix: Use withCredentials with usernamePassword binding:
```groovy
withCredentials([usernamePassword(
    credentialsId: 'dockerhub',
    usernameVariable: 'DOCKER_USER',
    passwordVariable: 'DOCKER_PASS'
)]) {
    sh 'echo $DOCKER_PASS | docker login -u $DOCKER_USER --password-stdin'
}
```


### No such image: mern-frontend:latest

Cause: docker-compose prefixes image names with the workspace folder name.
The workspace was mern-pipeline so images were named mern-pipeline-frontend
and mern-pipeline-backend.

Fix: Use the prefixed names in tag commands:
```groovy
sh "docker tag mern-pipeline-frontend ${IMAGE_FRONTEND}:latest"
sh "docker tag mern-pipeline-backend  ${IMAGE_BACKEND}:latest"
```



### DockerHub login fails — Gmail password not accepted

Cause: DockerHub requires a personal access token for CLI authentication.

Fix:
1. Go to https://hub.docker.com/settings/security
2. Generate a new access token with Read and Write permission
3. Use the token as the Password in the dockerhub Jenkins credential


### kubectl: not found

Cause: kubectl was not installed inside Jenkins.

Fix:
```bash
docker exec -it --user root jenkins bash
curl -LO "https://dl.k8s.io/release/$(curl -s https://dl.k8s.io/release/stable.txt)/bin/linux/amd64/kubectl"
chmod +x kubectl
mv kubectl /usr/local/bin/
exit
```



### dial tcp 192.168.49.2:8443: i/o timeout

Cause: Jenkins could not reach the Minikube cluster because they were on
different Docker networks.

Fix:
```bash
docker network connect minikube jenkins
docker exec jenkins kubectl get nodes
```


### Could not find /var/jenkins_home/.kube in container

Cause: The .kube directory did not exist inside Jenkins.

Fix:
```bash
docker exec -it --user root jenkins bash
mkdir -p /var/jenkins_home/.kube
mkdir -p /home/user/.minikube/profiles/minikube
exit

docker cp ~/.kube/config jenkins:/var/jenkins_home/.kube/config
docker cp ~/.minikube/ca.crt jenkins:/home/user/.minikube/ca.crt
docker cp ~/.minikube/profiles/minikube/client.crt jenkins:/home/user/.minikube/profiles/minikube/client.crt
docker cp ~/.minikube/profiles/minikube/client.key jenkins:/home/user/.minikube/profiles/minikube/client.key
```


## Stage Progress

| Stage                   | Status | Main issue encountered                         |
|-------------------------|--------|------------------------------------------------|
| Clone Repository        | DONE   | Wrong repo name in URL                         |
| Install Dependencies    | DONE   | npm not found, npm ci without lockfile         |
| SonarQube Analysis      | DONE   | Scanner not found, wrong network, missing key  |
| Docker Compose Build    | DONE   | docker not found, socket permissions, V1 vs V2 |
| Push Images to DockerHub| DONE   | Bad credentials binding, wrong image names     |
| Deploy to Kubernetes    | DONE   | kubectl not found, network, missing .kube dir  |


*Student DevOps project — MERN stack CI/CD pipeline with Jenkins, SonarQube, Docker, and Kubernetes.*
