output "role_arn" {
  description = "Set this as CV_AWS_ROLE_ARN in the Vercel project (Production)."
  value       = aws_iam_role.cv_download.arn
}

output "trusted_subjects" {
  description = "The Vercel project and environments allowed to assume the role."
  value       = local.subjects
}
