resource "kubernetes_namespace" "discord_bot" {
  metadata {
    name = "discord-bot"
  }
}

resource "kubernetes_secret" "discord_bot_secrets" {
  metadata {
    name      = "discord-bot-secrets"
    namespace = kubernetes_namespace.discord_bot.metadata[0].name
  }

  data = {
    DISCORD_TOKEN         = var.discord_token
    LITELLM_API_KEY       = var.litellm_api_key
    AWS_ACCESS_KEY_ID     = var.aws_access_key
    AWS_SECRET_ACCESS_KEY = var.aws_secret_key
  }

  type = "Opaque"
}

data "aws_ecr_authorization_token" "token" {}

resource "kubernetes_secret" "ecr_registry" {
  metadata {
    name      = "ecr-registry"
    namespace = kubernetes_namespace.discord_bot.metadata[0].name
  }

  type = "kubernetes.io/dockerconfigjson"

  data = {
    ".dockerconfigjson" = jsonencode({
      auths = {
        "${split("/", aws_ecr_repository.discord_bot.repository_url)[0]}" = {
          auth = data.aws_ecr_authorization_token.token.authorization_token
        }
      }
    })
  }
}

resource "kubernetes_deployment" "discord_bot" {
  metadata {
    name      = "discord-bot"
    namespace = kubernetes_namespace.discord_bot.metadata[0].name
    labels = {
      app = "discord-bot"
    }
  }

  spec {
    replicas = 1

    selector {
      match_labels = {
        app = "discord-bot"
      }
    }

    template {
      metadata {
        labels = {
          app = "discord-bot"
        }
      }

      spec {
        image_pull_secrets {
          name = kubernetes_secret.ecr_registry.metadata[0].name
        }

        container {
          image             = "${aws_ecr_repository.discord_bot.repository_url}:latest"
          image_pull_policy = "Always"
          name              = "discord-bot"

          port {
            container_port = 3000
            name           = "http"
          }

          env {
            name = "DISCORD_TOKEN"
            value_from {
              secret_key_ref {
                name = kubernetes_secret.discord_bot_secrets.metadata[0].name
                key  = "DISCORD_TOKEN"
              }
            }
          }

          env {
            name = "LITELLM_API_KEY"
            value_from {
              secret_key_ref {
                name = kubernetes_secret.discord_bot_secrets.metadata[0].name
                key  = "LITELLM_API_KEY"
              }
            }
          }

          env {
            name = "AWS_ACCESS_KEY_ID"
            value_from {
              secret_key_ref {
                name = kubernetes_secret.discord_bot_secrets.metadata[0].name
                key  = "AWS_ACCESS_KEY_ID"
              }
            }
          }

          env {
            name = "AWS_SECRET_ACCESS_KEY"
            value_from {
              secret_key_ref {
                name = kubernetes_secret.discord_bot_secrets.metadata[0].name
                key  = "AWS_SECRET_ACCESS_KEY"
              }
            }
          }

          env {
            name  = "DISCORD_BOT_ID"
            value = var.discord_bot_id
          }

          env {
            name  = "DISCORD_GUILD_ID"
            value = var.discord_guild_id
          }

          env {
            name  = "LITELLM_BASE_URL"
            value = var.litellm_base_url
          }

          env {
            name  = "AWS_REGION"
            value = var.region
          }

          env {
            name  = "DYNAMODB_SESSIONS_TABLE"
            value = aws_dynamodb_table.discord_sessions.name
          }

          env {
            name  = "DYNAMODB_EXECUTIONS_TABLE"
            value = aws_dynamodb_table.discord_executions.name
          }

          env {
            name  = "BOT_USERNAME"
            value = "nepnep"
          }

          env {
            name  = "OTHER_BOT_USERNAME"
            value = "nepgear"
          }

          env {
            name  = "STALENESS_MINUTES"
            value = "30"
          }

          env {
            name  = "PORT"
            value = "3000"
          }

          liveness_probe {
            http_get {
              path = "/health"
              port = 3000
            }
            initial_delay_seconds = 10
            period_seconds        = 30
          }

          readiness_probe {
            http_get {
              path = "/ready"
              port = 3000
            }
            initial_delay_seconds = 5
            period_seconds        = 10
          }

          resources {
            requests = {
              memory = "256Mi"
            }
       
          }
        }
      }
    }
  }

  depends_on = [null_resource.packer_build]
}

resource "kubernetes_service_account" "sandbox" {
  metadata {
    name      = "sandbox"
    namespace = kubernetes_namespace.discord_bot.metadata[0].name
  }
}

resource "kubernetes_cluster_role" "sandbox_reader" {
  metadata {
    name = "sandbox-reader"
  }

  rule {
    api_groups = ["", "apps", "batch", "extensions"]
    resources  = ["*"]
    verbs      = ["get", "list", "watch"]
  }
}

resource "kubernetes_cluster_role_binding" "sandbox_reader" {
  metadata {
    name = "sandbox-reader-binding"
  }

  role_ref {
    api_group = "rbac.authorization.k8s.io"
    kind      = "ClusterRole"
    name      = kubernetes_cluster_role.sandbox_reader.metadata[0].name
  }

  subject {
    kind      = "ServiceAccount"
    name      = kubernetes_service_account.sandbox.metadata[0].name
    namespace = kubernetes_namespace.discord_bot.metadata[0].name
  }
}

resource "kubernetes_deployment" "dev_sandbox" {
  metadata {
    name      = "dev-sandbox"
    namespace = kubernetes_namespace.discord_bot.metadata[0].name
    labels = {
      app = "dev-sandbox"
    }
  }

  spec {
    replicas = 1

    selector {
      match_labels = {
        app = "dev-sandbox"
      }
    }

    template {
      metadata {
        labels = {
          app = "dev-sandbox"
        }
      }

      spec {
        service_account_name = kubernetes_service_account.sandbox.metadata[0].name

        image_pull_secrets {
          name = kubernetes_secret.ecr_registry.metadata[0].name
        }

        init_container {
          name  = "git-init"
          image = "public.ecr.aws/docker/library/node:20-alpine"
          
          command = ["/bin/sh", "-c"]
          args = [<<-EOF
apk add --no-cache git aws-cli
git config --global credential.helper '!aws codecommit credential-helper $@'
git config --global credential.UseHttpPath true
git config --global user.email "system@barelycompetent.xyz"
git config --global user.name "bot"

cd /workspace

if [ -n "$CODECOMMIT_REPO" ]; then
  if git clone "$CODECOMMIT_REPO" . 2>/dev/null; then
    echo "Repository cloned successfully"
    if ! git rev-parse HEAD >/dev/null 2>&1; then
      git checkout -b main
      git commit --allow-empty -m "Initial commit"
      git push -u origin main
    fi
  else
    echo "Clone failed, initializing new repository..."
    git init
    git remote add origin "$CODECOMMIT_REPO"
    git checkout -b main
    git commit --allow-empty -m "Initial commit"
    git push -u origin main 2>/dev/null || echo "Warning: Could not push to remote"
  fi
else
  echo "No CODECOMMIT_REPO set, skipping repository setup"
fi
EOF
          ]
          
          volume_mount {
            name       = "workspace"
            mount_path = "/workspace"
          }
          
          env {
            name  = "CODECOMMIT_REPO"
            value = data.aws_codecommit_repository.repo.clone_url_http
          }
          env {
            name  = "AWS_REGION"
            value = var.region
          }
          env {
            name = "AWS_ACCESS_KEY_ID"
            value_from {
              secret_key_ref {
                name = kubernetes_secret.discord_bot_secrets.metadata[0].name
                key  = "AWS_ACCESS_KEY_ID"
              }
            }
          }
          env {
            name = "AWS_SECRET_ACCESS_KEY"
            value_from {
              secret_key_ref {
                name = kubernetes_secret.discord_bot_secrets.metadata[0].name
                key  = "AWS_SECRET_ACCESS_KEY"
              }
            }
          }
        }
      
        container {
          name              = "mcp-filesystem"
          image             = "public.ecr.aws/docker/library/node:20-alpine"
          image_pull_policy = "Always"
          command = ["sh", "-c"]
          args = ["npx -y supergateway --port 8777 --stdio 'npx -y @modelcontextprotocol/server-filesystem /workspace'"]

          env {
            name  = "AWS_REGION"
            value = var.region
          }
          env {
            name = "AWS_ACCESS_KEY_ID"
            value_from {
              secret_key_ref {
                name = kubernetes_secret.discord_bot_secrets.metadata[0].name
                key  = "AWS_ACCESS_KEY_ID"
              }
            }
          }
          env {
            name = "AWS_SECRET_ACCESS_KEY"
            value_from {
              secret_key_ref {
                name = kubernetes_secret.discord_bot_secrets.metadata[0].name
                key  = "AWS_SECRET_ACCESS_KEY"
              }
            }
          }
          port {
            container_port = 8777
            name           = "mcp-fs"
          }

          liveness_probe {
            tcp_socket {
              port = 8777
            }
            initial_delay_seconds = 15
            period_seconds        = 10
            timeout_seconds       = 5
            failure_threshold     = 3
          }

          volume_mount {
            name       = "workspace"
            mount_path = "/workspace"
                        read_only = false

          }

          resources {
            requests = {
              memory = "256Mi"
            }
            limits = {
              memory = "512Mi"
            }
          }
        }

        
        container {
          name              = "mcp-git"
          image             = "public.ecr.aws/docker/library/node:20-alpine"
          image_pull_policy = "Always"
          
          command = ["sh", "-c"]
          args = ["apk add --no-cache git python3 py3-pip && pip3 install --break-system-packages uv && npx -y supergateway --port 8778 --stdio 'uvx mcp-server-git --repository /workspace'"]

          port {
            container_port = 8778
            name           = "mcp-git"
          }

          liveness_probe {
            tcp_socket {
              port = 8778
            }
            initial_delay_seconds = 15
            period_seconds        = 10
          }

          volume_mount {
            name       = "workspace"
            mount_path = "/workspace"
                        read_only = false

          }

          env {
            name  = "AWS_REGION"
            value = var.region
          }
          env {
            name = "AWS_ACCESS_KEY_ID"
            value_from {
              secret_key_ref {
                name = kubernetes_secret.discord_bot_secrets.metadata[0].name
                key  = "AWS_ACCESS_KEY_ID"
              }
            }
          }
          env {
            name = "AWS_SECRET_ACCESS_KEY"
            value_from {
              secret_key_ref {
                name = kubernetes_secret.discord_bot_secrets.metadata[0].name
                key  = "AWS_SECRET_ACCESS_KEY"
              }
            }
          }

            resources {
            requests = {
              memory = "256Mi"
            }
            limits = {
              memory = "512Mi"
            }
          }
        }

        container {
          name              = "mcp-shell"
          image             = "${aws_ecr_repository.dev_sandbox.repository_url}:latest"
          image_pull_policy = "Always"

          command = ["sh", "-c"]
          args = ["npx -y supergateway --port 8779 --stdio 'npx -y mcp-server-commands'"]

          port {
            container_port = 8779
            name           = "mcp-shell"
          }

          liveness_probe {
            tcp_socket {
              port = 8779
            }
            initial_delay_seconds = 15
            period_seconds        = 10
          }

          volume_mount {
            name       = "workspace"
            mount_path = "/workspace"
            read_only = false
          }

          env {
            name  = "AWS_REGION"
            value = var.region
          }
          env {
            name = "AWS_ACCESS_KEY_ID"
            value_from {
              secret_key_ref {
                name = kubernetes_secret.discord_bot_secrets.metadata[0].name
                key  = "AWS_ACCESS_KEY_ID"
              }
            }
          }
          env {
            name = "AWS_SECRET_ACCESS_KEY"
            value_from {
              secret_key_ref {
                name = kubernetes_secret.discord_bot_secrets.metadata[0].name
                key  = "AWS_SECRET_ACCESS_KEY"
              }
            }
          }

          resources {
            requests = {
              memory = "1Gi"
            }
       
          }
        }

        volume {
          name = "workspace"
          empty_dir {}
        }
      }
    }
  }

  depends_on = [null_resource.dev_sandbox_build]
}

resource "kubernetes_service" "mcp_filesystem" {
  metadata {
    name      = "filesystem-service"
    namespace = kubernetes_namespace.discord_bot.metadata[0].name
  }
  spec {
    type = "ClusterIP"

    selector = {
      app = "dev-sandbox"
    }
    port {
      name        = "mcp-http"
      protocol    = "TCP"
      port        = 8777
      target_port = 8777
    }
  }
}

resource "kubernetes_service" "mcp_git" {
  metadata {
    name      = "git-service"
    namespace = kubernetes_namespace.discord_bot.metadata[0].name
  }
  spec {
    type = "ClusterIP"

    selector = {
      app = "dev-sandbox"
    }
    port {
      name        = "mcp-http"
      protocol    = "TCP"
      port        = 8778
      target_port = 8778
    }
  }
}

resource "kubernetes_service" "mcp_shell" {
  metadata {
    name      = "shell-service"
    namespace = kubernetes_namespace.discord_bot.metadata[0].name
  }
  spec {
    type = "ClusterIP"

    selector = {
      app = "dev-sandbox"
    }
    port {
      name        = "mcp-http"
      protocol    = "TCP"
      port        = 8779
      target_port = 8779
    }
  }
}