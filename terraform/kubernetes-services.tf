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
