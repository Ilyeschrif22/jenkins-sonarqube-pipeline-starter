pipeline {
    agent any

    tools {
        nodejs 'NodeJS-18'
    }

    environment {
        DOCKERHUB_USER = 'ilyeschrif21'
        IMAGE_BACKEND  = "${DOCKERHUB_USER}/mern-backend"
        IMAGE_FRONTEND = "${DOCKERHUB_USER}/mern-frontend"
        DOCKER_CREDS   = credentials('dockerhub')
    }

    stages {

        stage('Clone Repository') {
            steps {
                git branch: 'main',
                    url: 'https://github.com/Ilyeschrif22/jenkins-sonarqube-pipeline-starter.git'
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
                sh 'docker compose build'
            }
        }

        stage('Push Images to DockerHub') {
            steps {
                sh "echo ${DOCKER_CREDS_PSW} | docker login -u ${DOCKER_CREDS_USR} --password-stdin"

                sh "docker tag mern-frontend ${IMAGE_FRONTEND}:${BUILD_NUMBER}"
                sh "docker tag mern-frontend ${IMAGE_FRONTEND}:latest"
                sh "docker tag mern-backend  ${IMAGE_BACKEND}:${BUILD_NUMBER}"
                sh "docker tag mern-backend  ${IMAGE_BACKEND}:latest"

                sh "docker push ${IMAGE_FRONTEND}:${BUILD_NUMBER}"
                sh "docker push ${IMAGE_FRONTEND}:latest"
                sh "docker push ${IMAGE_BACKEND}:${BUILD_NUMBER}"
                sh "docker push ${IMAGE_BACKEND}:latest"
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
