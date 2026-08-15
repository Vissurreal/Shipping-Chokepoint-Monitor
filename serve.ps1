# ---------------------------------------------------------------------------
# Minimal dependency-free static file server for the Command Center.
# Uses TcpListener (no admin / URL-ACL needed, unlike HttpListener).
# Usage:  powershell -ExecutionPolicy Bypass -File serve.ps1 [-Port 8123]
# ---------------------------------------------------------------------------
param([int]$Port = 8123)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path

$mime = @{
  '.html' = 'text/html; charset=utf-8'
  '.css'  = 'text/css; charset=utf-8'
  '.js'   = 'application/javascript; charset=utf-8'
  '.json' = 'application/json; charset=utf-8'
  '.svg'  = 'image/svg+xml'
  '.png'  = 'image/png'
  '.ico'  = 'image/x-icon'
  '.map'  = 'application/json'
}

$listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, $Port)
$listener.Start()
Write-Host "Command Center serving $root at http://localhost:$Port/  (Ctrl+C to stop)"

function Send-Response($stream, $status, $headers, [byte[]]$body) {
  $sb = "HTTP/1.1 $status`r`n"
  foreach ($k in $headers.Keys) { $sb += "$k`: $($headers[$k])`r`n" }
  $sb += "Content-Length: $($body.Length)`r`n"
  $sb += "Connection: close`r`n`r`n"
  $head = [System.Text.Encoding]::ASCII.GetBytes($sb)
  $stream.Write($head, 0, $head.Length)
  if ($body.Length) { $stream.Write($body, 0, $body.Length) }
  $stream.Flush()
}

while ($true) {
  $client = $listener.AcceptTcpClient()
  try {
    $stream = $client.GetStream()
    $reader = [System.IO.StreamReader]::new($stream)
    $requestLine = $reader.ReadLine()
    if (-not $requestLine) { $client.Close(); continue }

    $parts = $requestLine -split ' '
    $path = if ($parts.Count -ge 2) { $parts[1] } else { '/' }
    $path = ($path -split '\?')[0]
    if ($path -eq '/') { $path = '/index.html' }

    # Prevent directory traversal.
    $rel = $path.TrimStart('/') -replace '/', '\'
    $full = [System.IO.Path]::GetFullPath((Join-Path $root $rel))
    if (-not $full.StartsWith([System.IO.Path]::GetFullPath($root))) {
      Send-Response $stream '403 Forbidden' @{ 'Content-Type' = 'text/plain' } ([System.Text.Encoding]::UTF8.GetBytes('Forbidden'))
      $client.Close(); continue
    }

    if (Test-Path $full -PathType Leaf) {
      $ext = [System.IO.Path]::GetExtension($full).ToLower()
      $ct = if ($mime.ContainsKey($ext)) { $mime[$ext] } else { 'application/octet-stream' }
      $bytes = [System.IO.File]::ReadAllBytes($full)
      Send-Response $stream '200 OK' @{ 'Content-Type' = $ct; 'Cache-Control' = 'no-store' } $bytes
    } else {
      Send-Response $stream '404 Not Found' @{ 'Content-Type' = 'text/plain' } ([System.Text.Encoding]::UTF8.GetBytes('Not found'))
    }
  } catch {
    Write-Host "err: $($_.Exception.Message)"
  } finally {
    $client.Close()
  }
}
