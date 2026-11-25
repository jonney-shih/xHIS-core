{{- define "xguard-ops.fullname" -}}
{{- .Release.Name }}-xguard-ops
{{- end -}}

{{- define "xguard-ops.labels" -}}
app.kubernetes.io/name: xguard-ops
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/version: {{ .Chart.AppVersion }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end -}}
