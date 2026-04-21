# MERN App — DevOps Deployment Pipeline

A full CI/CD pipeline deploying a MERN (MongoDB, Express, React, Node.js) application using : 

**GitHub -> Jenkins -> Docker -> Kubernetes**.

---

## Environment Setup

Before anything else, make sure Docker is installed on your machine. Then start Jenkins using Docker:

```bash
docker run -d \
  --name jenkins \
  -p 8080:8080 \
  -p 50000:50000 \
  -v jenkins_home:/var/jenkins_home \
  jenkins/jenkins:lts
```

Check it is running:

```bash
docker ps
```

Get the initial admin password:

```bash
docker exec jenkins cat /var/jenkins_home/secrets/initialAdminPassword
```

Open **http://localhost:8080** in your browser and paste the password in when prompted. Then install the suggested plugins before proceeding.

### Install Sonarqube 

```bash 
docker run -d \
  --name sonarqube \
  -p 9000:9000 \
  -v $(pwd)/sonar_data:/opt/sonarqube/data \
  -v $(pwd)/sonar_extensions:/opt/sonarqube/extensions \
  -v $(pwd)/sonar_logs:/opt/sonarqube/logs \
  sonarqube:latest
```


### Install Kubernetes Tools

Run this on your machine and on every node (master and workers). The version must match across all machines.

```bash
sudo apt update
sudo apt install -y apt-transport-https ca-certificates curl

curl -fsSL https://pkgs.k8s.io/core:/stable:/v1.35/deb/Release.key | sudo gpg --dearmor -o /etc/apt/keyrings/kubernetes-apt-keyring.gpg

echo 'deb [signed-by=/etc/apt/keyrings/kubernetes-apt-keyring.gpg] https://pkgs.k8s.io/core:/stable:/v1.35/deb/ /' | sudo tee /etc/apt/sources.list.d/kubernetes.list

sudo apt update
sudo apt install -y kubelet kubeadm kubectl
sudo apt-mark hold kubelet kubeadm kubectl
```

Verify the installation:

```bash
kubeadm version
kubectl version --client
```

## Architecture Overview

```
Developer
   |
   |  git push
   v
GitHub Repository
   |
   v
Jenkins CI/CD
   |  build docker image
   v
Docker Registry (DockerHub)
   |
   v
Kubernetes Cluster (kubeadm)
   |
   v
Pods (React + Node + MongoDB)
```

## Repository Structure

```
mern-app/
|
|-- frontend/
|   |-- Dockerfile
|   └── (React source code)
|
|-- backend/
|   |-- Dockerfile
|   └── (Node/Express source code)
|
|-- k8s/
|   |-- frontend-deployment.yaml
|   |-- backend-deployment.yaml
|   └── mongo.yaml
|
└── Jenkinsfile
```

---

## Step 1 — Dockerize the Application

### Backend Dockerfile (`backend/Dockerfile`)

```dockerfile
FROM node:18

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

EXPOSE 5000

CMD ["npm", "start"]
```

### Frontend Dockerfile (`frontend/Dockerfile`)

```dockerfile
FROM node:18 as build

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .
RUN npm run build

FROM nginx:alpine
COPY --from=build /app/build /usr/share/nginx/html

EXPOSE 80
```

---

## Step 2 — Build and Test Docker Images Locally

```bash
# Build images
docker build -t mern-backend ./backend
docker build -t mern-frontend ./frontend

# Run locally to test
docker run -p 5000:5000 mern-backend
docker run -p 3000:80 mern-frontend
```

## Step 3 — Push Images to DockerHub

```bash
# Login to DockerHub
docker login

# Tag images
docker tag mern-backend <your-username>/mern-backend:latest
docker tag mern-frontend <your-username>/mern-frontend:latest

# Push images
docker push <your-username>/mern-backend:latest
docker push <your-username>/mern-frontend:latest
```

> Replace `<your-username>` with your DockerHub username throughout this project.

---

## Step 4 — Kubernetes Deployment Files

### Backend Deployment (`k8s/backend-deployment.yaml`)

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: backend
spec:
  replicas: 3
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
        image: <your-username>/mern-backend:latest
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

### Frontend Deployment (`k8s/frontend-deployment.yaml`)

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: frontend
spec:
  replicas: 2
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
        image: <your-username>/mern-frontend:latest
        ports:
        - containerPort: 80
```

---

## Step 5 — Deploy to Kubernetes

```bash
# Add user to the Docker group
sudo usermod -aG docker $USER
newgrp docker

# Start Kubernetes (Minikube)
minikube start --driver=docker

# Apply all manifests
kubectl apply -f k8s/

# Verify pods are running
kubectl get pods

# Check services
kubectl get svc
```



## Step 6 — Install Jenkins

Run Jenkins in Docker:

```bash
docker run -d \
  --name jenkins \
  -p 8080:8080 \
  -p 50000:50000 \
  -v jenkins_home:/var/jenkins_home \
  jenkins/jenkins:lts
```

Check it is running:

```bash
docker ps
```

Get the initial admin password:

```bash
docker exec jenkins cat /var/jenkins_home/secrets/initialAdminPassword
```

Open Jenkins at **http://localhost:8080** and paste the password in when prompted.

### Required Jenkins Plugins

Install these from **Manage Jenkins -> Plugin Manager**:

| Plugin | Purpose |
|--------|---------|
| Docker | Build and push Docker images |
| Kubernetes | Deploy to Kubernetes cluster |
| Git | Clone from GitHub |
| Pipeline | Run Jenkinsfile pipelines |

---

## Step 7 — Connect Jenkins to GitHub

1. In Jenkins, click **New Item -> Pipeline**
2. Under **Pipeline Definition**, select: `Pipeline script from SCM`
3. Set SCM to **Git**
4. Enter your repository URL:
   ```
   https://github.com/<your-username>/mern-app
   ```

---

## Step 8 — Jenkinsfile (CI/CD Pipeline)

Place this file at the root of the repo:

```groovy
pipeline {
    agent any

    stages {

        stage('Clone Repo') {
            steps {
                git 'https://github.com/<your-username>/mern-app.git'
            }
        }

        stage('Build Docker Images') {
            steps {
                sh 'docker build -t <your-username>/mern-backend ./backend'
                sh 'docker build -t <your-username>/mern-frontend ./frontend'
            }
        }

        stage('Push Images') {
            steps {
                sh 'docker push <your-username>/mern-backend'
                sh 'docker push <your-username>/mern-frontend'
            }
        }

        stage('Deploy to Kubernetes') {
            steps {
                sh 'kubectl apply -f k8s/'
            }
        }

    }
}
```

---

## Full CI/CD Flow Summary

```
Developer pushes code
        |
        v
      GitHub
        |
        v
      Jenkins
        |
  Build Docker Images
        |
  Push to DockerHub
        |
  Deploy to Kubernetes
        |
  Pods Updated Automatically
```

---

## What This Project Demonstrates

| Technology | Role |
|------------|------|
| GitHub | Version control and source of truth |
| Jenkins | CI/CD automation pipeline |
| Docker | Containerization of services |
| DockerHub | Container image registry |
| Kubernetes | Container orchestration and scaling |

---

## Setting Up the Kubernetes Cluster (Master and Workers)

Follow these steps on all machines first, then initialize the master and join the workers.

### Requirements

- At least 2 CPUs and 2GB RAM per machine
- All machines on the same network and able to ping each other
- Ubuntu or compatible Linux distro on all nodes

---

### On All Machines (Master and Workers)

**1. Disable swap — kubeadm requires this**

```bash
sudo swapoff -a
sudo sed -i '/ swap / s/^/#/' /etc/fstab
```

**2. Open required ports on all machines**

| Port | Purpose |
|------|---------|
| 6443 | Kubernetes API server |
| 2379-2380 | etcd |
| 10250 | kubelet |
| 10251 | kube-scheduler |
| 10252 | kube-controller-manager |
| 30000-32767 | NodePort services |

```bash
sudo ufw allow 6443
sudo ufw allow 2379:2380/tcp
sudo ufw allow 10250
sudo ufw allow 10251
sudo ufw allow 10252
sudo ufw allow 30000:32767/tcp
```

> If your friends are on a different distro (CentOS, Fedora), replace `ufw` with `firewall-cmd` or `iptables` commands.

**3. Install containerd (container runtime)**

```bash
sudo apt update
sudo apt install -y containerd
sudo mkdir -p /etc/containerd
containerd config default | sudo tee /etc/containerd/config.toml
sudo systemctl restart containerd
sudo systemctl enable containerd
```

**4. Install kubeadm, kubelet, and kubectl**

Pin the version so all machines match — this example uses v1.29:

```bash
sudo apt update
sudo apt install -y apt-transport-https ca-certificates curl

curl -fsSL https://pkgs.k8s.io/core:/stable:/v1.29/deb/Release.key | sudo gpg --dearmor -o /etc/apt/keyrings/kubernetes-apt-keyring.gpg

echo 'deb [signed-by=/etc/apt/keyrings/kubernetes-apt-keyring.gpg] https://pkgs.k8s.io/core:/stable:/v1.29/deb/ /' | sudo tee /etc/apt/sources.list.d/kubernetes.list

sudo apt update
sudo apt install -y kubelet=1.29.0-1.1 kubeadm=1.29.0-1.1 kubectl=1.29.0-1.1
sudo apt-mark hold kubelet kubeadm kubectl
```

> All machines must install the exact same version. Using `apt-mark hold` prevents accidental upgrades.

---

### On the Master Node Only

**5. Initialize the cluster**

```bash
sudo kubeadm init --pod-network-cidr=192.168.0.0/16
```

**6. Set up kubectl access**

```bash
mkdir -p $HOME/.kube
sudo cp -i /etc/kubernetes/admin.conf $HOME/.kube/config
sudo chown $(id -u):$(id -g) $HOME/.kube/config
```

**7. Install a pod network (Calico)**

```bash
kubectl apply -f https://docs.projectcalico.org/manifests/calico.yaml
```

**8. Get the join command**

At the end of `kubeadm init` you will see a join command. Copy it — it looks like this:

```bash
kubeadm join <master-ip>:6443 --token <token> --discovery-token-ca-cert-hash sha256:<hash>
```

If you lose it, regenerate it on the master:

```bash
kubeadm token create --print-join-command
```

---

### On Each Worker Node

**9. Join the cluster**

Run the join command from the previous step on each worker machine:

```bash
sudo kubeadm join <master-ip>:6443 --token <token> --discovery-token-ca-cert-hash sha256:<hash>
```

---

### Verify the Cluster

Back on the master, check that all nodes are connected:

```bash
kubectl get nodes
```

You should see the master and all workers listed with a status of `Ready`. This may take a minute or two after joining.

---

## Prerequisites

- Docker installed locally
- DockerHub account
- Kubernetes cluster (kubeadm, Minikube, or cloud provider)
- kubectl configured and pointing to your cluster
- Jenkins running (locally or on a server)
- GitHub account with the repo pushed

---

## Troubleshooting

**Pods not starting?**
```bash
kubectl describe pod <pod-name>
kubectl logs <pod-name>
```

**Jenkins cannot connect to Docker?**
```bash
# Add Jenkins user to Docker group
sudo usermod -aG docker jenkins
sudo systemctl restart jenkins
```

**kubectl not found in Jenkins?**
- Make sure kubectl is installed on the Jenkins agent machine
- Configure the Kubernetes plugin with your cluster credentials

---

*This is a student DevOps project demonstrating a complete containerized microservice deployment pipeline.*
