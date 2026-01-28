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

resource "kubernetes_service_account" "discord_bot" {
  metadata {
    name      = "discord-bot"
    namespace = kubernetes_namespace.discord_bot.metadata[0].name
  }
}

resource "kubernetes_role" "pod_exec" {
  metadata {
    name      = "pod-exec"
    namespace = kubernetes_namespace.discord_bot.metadata[0].name
  }

  rule {
    api_groups = [""]
    resources  = ["pods", "pods/exec"]
    verbs      = ["get", "list", "create"]
  }

  rule {
    api_groups = [""]
    resources  = ["pods/log"]
    verbs      = ["get"]
  }
}

resource "kubernetes_role_binding" "discord_bot_exec" {
  metadata {
    name      = "discord-bot-exec"
    namespace = kubernetes_namespace.discord_bot.metadata[0].name
  }

  role_ref {
    api_group = "rbac.authorization.k8s.io"
    kind      = "Role"
    name      = kubernetes_role.pod_exec.metadata[0].name
  }

  subject {
    kind      = "ServiceAccount"
    name      = kubernetes_service_account.discord_bot.metadata[0].name
    namespace = kubernetes_namespace.discord_bot.metadata[0].name
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
        service_account_name = kubernetes_service_account.discord_bot.metadata[0].name

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

          env {
            name  = "S3_ARTIFACT_BUCKET"
            value = var.s3_artifact_bucket
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
          name  = "s3-sync-init"
          image = "amazon/aws-cli:latest"
          
          command = ["/bin/sh", "-c"]
          args = [<<-EOF
# Create workspace directory
mkdir -p /workspace

# Check if THREAD_ID is set (for per-thread workspaces)
if [ -n "$THREAD_ID" ]; then
  echo "Syncing workspace from S3 for thread: $THREAD_ID"
  # Sync from S3 if exists (ignore errors if no previous state)
  aws s3 sync s3://${aws_s3_bucket.artifacts.id}/threads/$THREAD_ID/ /workspace/ --region $AWS_REGION || echo "No previous workspace state found"
else
  echo "No THREAD_ID set, starting with empty workspace"
fi

echo "Workspace initialization complete"
ls -la /workspace/
EOF
          ]
          
          volume_mount {
            name       = "workspace"
            mount_path = "/workspace"
          }
          
          env {
            name  = "AWS_REGION"
            value = var.region
          }
          env {
            name  = "S3_ARTIFACT_BUCKET"
            value = aws_s3_bucket.artifacts.id
          }
          env {
            name = "THREAD_ID"
            value = ""  # Will be set dynamically by workspace manager
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