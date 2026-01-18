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
  type = string
  default = "latest"
}

source "docker" "discord_bot" {
  image  = "public.ecr.aws/docker/library/python:3.12-slim"
  commit = true
  changes = [
    "WORKDIR /app",
    "CMD [\"python\", \"bot.py\"]"
  ]
}

build {
  name = "discord-bot"
  sources = ["source.docker.discord_bot"]

  provisioner "shell" {
    inline = [
      "mkdir -p /app"
    ]
  }

  # Copy and install requirements
  provisioner "file" {
    source      = "../app/requirements.txt"
    destination = "/app/requirements.txt"
  }

  provisioner "shell" {
    inline = [
      "pip install --no-cache-dir -r /app/requirements.txt"
    ]
  }

  # Copy application code
  provisioner "file" {
    source      = "../app/bot.py"
    destination = "/app/bot.py"
  }

  post-processors {
    post-processor "docker-tag" {
      repository = var.image_repository
      tags       = [var.image_tag, "latest"]
    }
    post-processor "docker-push" {
        ecr_login = true
        login_server = split("/", var.image_repository)[0]
    }
  }
}
