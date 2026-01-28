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

echo "Syncing entire bucket from S3..."
# Sync the entire bucket (includes all thread-id folders)
aws s3 sync s3://${aws_s3_bucket.artifacts.id}/ /workspace/ --region $AWS_REGION || echo "No previous workspace state found"

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
          command           = ["sh", "-c"]
          args              = ["npx -y supergateway --port 8777 --stdio 'npx -y @modelcontextprotocol/server-filesystem /workspace'"]

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
            read_only  = false

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
          args    = ["npx -y supergateway --port 8779 --stdio 'npx -y mcp-server-commands'"]

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
            read_only  = false
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
