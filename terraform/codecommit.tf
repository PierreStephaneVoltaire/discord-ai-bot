resource "aws_codecommit_repository" "discord_ai_sandbox" {
  repository_name = "discord-ai-sandbox"
  description     = "CodeCommit repository for the Discord AI sandbox"
}
