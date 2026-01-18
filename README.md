# Discord to n8n Forwarder Bot

This project implements a Discord bot that listens for new messages in a Discord server and forwards them to an [n8n](https://n8n.io/) webhook. It allows you to trigger complex workflows and automations in n8n based on Discord activity.

The project is designed with production standards in mind, including containerization using **Packer** and infrastructure-as-code deployment via **Terraform** (targeting AWS and Kubernetes).

## Features

- **Real-time Forwarding**: Instantly sends new Discord messages to a specified n8n webhook URL.
- **Rich Payload**: Includes detailed message data such as:
  - Content
  - Author details (ID, username, discriminator)
  - Channel and Guild IDs
  - Attachment URLs and types
  - Timestamps
- **Containerized**: Built with Docker and Packer for consistent environments.
- **Infrastructure as Code**: Terraform configuration provided for deploying to Kubernetes on AWS.

## Project Structure

```
.
├── app/                # Python application source code
│   ├── bot.py          # Main bot logic
│   └── requirements.txt # Python dependencies
├── docker/             # Packer configuration for building the Docker image
│   └── build.pkr.hcl
└── terraform/          # Terraform configuration for infrastructure
    ├── main.tf         # Provider setup
    ├── kubernetes.tf   # K8s resources (Deployment, etc.)
    └── ...
```

## Prerequisites

- **Python 3.12+** (for local development)
- **Discord Bot Token**: Obtained from the [Discord Developer Portal](https://discord.com/developers/applications).
- **n8n Workflow**: An active n8n workflow with a Webhook node to receive the data.
- **Tools** (for deployment):
  - [Docker](https://www.docker.com/)
  - [Packer](https://www.packer.io/)
  - [Terraform](https://www.terraform.io/)
  - AWS CLI (configured with appropriate credentials)

## Local Development

1.  **Clone the repository:**
    ```bash
    git clone <repository_url>
    cd discord-n8n-bot
    ```

2.  **Install dependencies:**
    It is recommended to use a virtual environment.
    ```bash
    python -m venv venv
    source venv/bin/activate  # On Windows: venv\Scripts\activate
    pip install -r app/requirements.txt
    ```

3.  **Configure Environment Variables:**
    Set the following environment variables:
    ```bash
    export DISCORD_TOKEN="your_discord_bot_token"
    export N8N_WEBHOOK_URL="your_n8n_webhook_url"
    ```

4.  **Run the Bot:**
    ```bash
    python app/bot.py
    ```

## Building the Docker Image (Packer)

This project uses Packer to build the Docker image and push it to a repository (e.g., AWS ECR).

1.  Navigate to the `docker` directory:
    ```bash
    cd docker
    ```

2.  Initialize Packer:
    ```bash
    packer init build.pkr.hcl
    ```

3.  Build the image:
    You need to provide the target repository variable.
    ```bash
    packer build -var "image_repository=your-account-id.dkr.ecr.region.amazonaws.com/your-repo" build.pkr.hcl
    ```

## Deployment (Terraform)

The `terraform` directory contains configuration to deploy the bot to a Kubernetes cluster on AWS.

1.  Navigate to the `terraform` directory:
    ```bash
    cd terraform
    ```

2.  Initialize Terraform:
    ```bash
    terraform init
    ```

3.  Configure Variables:
    Create a `terraform.tfvars` file or pass variables via command line.
    Required variables:
    - `aws_access_key`
    - `aws_secret_key`
    - `discord_token`
    - `n8n_webhook_url`
    - `region` (default: `ca-central-1`)

4.  Deploy:
    ```bash
    terraform apply
    ```

## Payload Format

The data sent to n8n matches the following JSON structure:

```json
{
  "id": "123456789012345678",
  "channel_id": "987654321098765432",
  "guild_id": "112233445566778899",
  "content": "Hello world!",
  "author": {
    "id": "102030405060708090",
    "username": "User",
    "discriminator": "1234",
    "bot": false
  },
  "attachments": [
    {
      "id": "...",
      "filename": "image.png",
      "url": "https://cdn.discordapp.com/...",
      "content_type": "image/png"
    }
  ],
  "timestamp": "2023-10-27T10:00:00.000000+00:00"
}
```
