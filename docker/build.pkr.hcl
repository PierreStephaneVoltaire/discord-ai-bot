packer {
  required_plugins {
    docker = {
      version = ">= 1.0.0"
      source  = "github.com/hashicorp/docker"
    }
  }
}

variable "image_repository" {
  type = string
}

variable "image_tag" {
  type    = string
  default = "latest"
}

source "docker" "discord_bot" {
  image    = "public.ecr.aws/docker/library/node:20"
  commit   = true
  platform = "linux/amd64"
  changes = [
    "WORKDIR /app",
    "ENV PATH=/root/.local/bin:/usr/local/bin:$PATH",
    "CMD [\"node\", \"dist/index.js\"]"
  ]
}

build {
  name    = "discord-bot"
  sources = ["source.docker.discord_bot"]

  # Install system dependencies & Python
  provisioner "shell" {
    inline = [
      "apt-get update && apt-get install -y curl unzip ca-certificates git python3 python3-pip python3-venv",
      "rm -rf /var/lib/apt/lists/*",
      "mkdir -p /app"
    ]
  }

  # Install AWS CLI
  provisioner "shell" {
    inline = [
      "curl \"https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip\" -o \"/awscliv2.zip\"",
      "unzip /awscliv2.zip -d /",
      "/aws/install",
      "rm -rf /awscliv2.zip /aws",
      "aws --version"
    ]
  }

  # Install kubectl
  provisioner "shell" {
    inline = [
      "curl -LO \"https://dl.k8s.io/release/$(curl -L -s https://dl.k8s.io/release/stable.txt)/bin/linux/amd64/kubectl\"",
      "install -o root -g root -m 0755 kubectl /usr/local/bin/kubectl",
      "kubectl version --client"
    ]
  }

  # Install Helm
  provisioner "shell" {
    inline = [
      "curl https://raw.githubusercontent.com/helm/helm/main/scripts/get-helm-3 | bash",
      "helm version"
    ]
  }

  # Create directories
  provisioner "shell" {
    inline = [
      "mkdir -p /mnt/fs",
      "mkdir -p /root/.kube"
    ]
  }

  # Copy package files first for better caching
  provisioner "file" {
    source      = "../app/package.json"
    destination = "/app/package.json"
  }

  # Install dependencies
  provisioner "shell" {
    inline = [
      "cd /app && npm install"
    ]
  }

  # Copy TypeScript config
  provisioner "file" {
    source      = "../app/tsconfig.json"
    destination = "/app/tsconfig.json"
  }

  # Copy source code
  provisioner "file" {
    source      = "../app/src"
    destination = "/app/"
  }

  # Copy templates
  provisioner "file" {
    source      = "../app/templates"
    destination = "/app/"
  }

  # Build TypeScript
  provisioner "shell" {
    inline = [
      "cd /app && npm run build"
    ]
  }

  # Clean up dev dependencies and source
  provisioner "shell" {
    inline = [
      "cd /app && npm prune --production",
      "rm -rf /app/src /app/tsconfig.json"
    ]
  }
  
  post-processors {
    post-processor "docker-tag" {
      repository = var.image_repository
      tags       = [var.image_tag, "latest"]
    }
    post-processor "docker-push" {
      ecr_login    = true
      login_server = split("/", var.image_repository)[0]
    }
  }
}