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
