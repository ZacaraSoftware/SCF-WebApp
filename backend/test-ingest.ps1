$params = @{
    Uri = "https://ahdudpkosbzqmwignmzd.functions.supabase.co/ingest"
    Method = "POST"
    ContentType = "application/json"
    Body = '{"dryRun":true}'
}
try {
    $resp = Invoke-RestMethod @params -ErrorVariable err -ErrorAction Stop
    $resp | ConvertTo-Json -Depth 5
} catch {
    Write-Host "Error: $($_.Exception.Message)"
    if ($_.Exception.Response) {
        $reader = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())
        $reader.ReadToEnd() | Write-Host
    }
}
