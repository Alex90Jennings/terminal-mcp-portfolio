output "role_arn" {
  description = "Set this as AI_BEDROCK_ROLE_ARN in the Vercel project."
  value       = aws_iam_role.bedrock_chat.arn
}

output "trusted_subjects" {
  description = "The Vercel project and environments allowed to assume the role."
  value       = local.subjects
}
