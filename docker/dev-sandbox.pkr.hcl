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

source "docker" "dev_sandbox" {
  image    = "public.ecr.aws/ubuntu/ubuntu:24.04"
  commit   = true
  platform = "linux/amd64"
  changes = [
    "WORKDIR /workspace",
    "ENV PATH=/usr/local/bin:/root/.local/bin:$PATH",
    "ENV NVM_DIR=/root/.nvm",
  ]
}

build {
  name    = "dev-sandbox"
  sources = ["source.docker.dev_sandbox"]

  # Install system dependencies
 provisioner "shell" {
    inline = [
      "export DEBIAN_FRONTEND=noninteractive",
      "ln -fs /usr/share/zoneinfo/UTC /etc/localtime",
      "apt-get update && apt-get install -y --no-install-recommends curl wget unzip ca-certificates git build-essential python3 python3-pip python3-venv tzdata gnupg lsb-release jq vim less ripgrep fd-find tree htop netcat-openbsd dnsutils iputils-ping openssh-client shellcheck make",
      "dpkg-reconfigure --frontend noninteractive tzdata",
      "rm -rf /var/lib/apt/lists/*",
    ]
  }

  # Install uv
  provisioner "shell" {
    inline = [
      "curl -LsSf https://astral.sh/uv/install.sh | sh",
      "ln -sf /root/.local/bin/uv /usr/local/bin/uv",
      "ln -sf /root/.local/bin/uvx /usr/local/bin/uvx",
      "uv --version",
      "uvx --version"
    ]
  }

  # Install nvm and Node.js
  provisioner "shell" {
    environment_vars = [
      "UV_TOOL_BIN_DIR=/usr/local/bin"
    ]
    inline = [
      "curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash",
      "export NVM_DIR=\"/root/.nvm\"",
      ". \"$NVM_DIR/nvm.sh\"",
      "nvm install 20",
      "NODE_PATH=\"$NVM_DIR/versions/node/$(nvm current)/bin\"",
      "ln -sf \"$NODE_PATH/node\" /usr/local/bin/node",
      "ln -sf \"$NODE_PATH/npm\" /usr/local/bin/npm",
      "ln -sf \"$NODE_PATH/npx\" /usr/local/bin/npx",
      "node --version",
      "npm --version",
      "uv tool install fastmcp",
      "npm install -g supergateway",
      "ln -sf \"$NODE_PATH/supergateway\" /usr/local/bin/supergateway",
    ]
  }

  # Install AWS CLI v2
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
      "rm kubectl",
      "kubectl version --client"
    ]
  }

  # Install Helm 3
  provisioner "shell" {
    inline = [
      "curl https://raw.githubusercontent.com/helm/helm/main/scripts/get-helm-3 | bash",
      "helm version"
    ]
  }

  # Install Terraform
  provisioner "shell" {
    inline = [
      "wget -O- https://apt.releases.hashicorp.com/gpg | gpg --dearmor -o /usr/share/keyrings/hashicorp-archive-keyring.gpg",
      "echo \"deb [signed-by=/usr/share/keyrings/hashicorp-archive-keyring.gpg] https://apt.releases.hashicorp.com $(lsb_release -cs) main\" | tee /etc/apt/sources.list.d/hashicorp.list",
      "apt-get update && apt-get install -y terraform",
      "rm -rf /var/lib/apt/lists/*",
      "terraform version"
    ]
  }

  # Create directories
  provisioner "shell" {
    inline = [
      "mkdir -p /workspace",
      "mkdir -p /root/.kube"
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