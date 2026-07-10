$url = "https://ahdudpkosbzqmwignmzd.supabase.co/rest/v1/sources"
$anonKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFoZHVkcGtvc2J6cW13aWdubXptZCIsInJvbGUiOiJhbm9uIiwiaWF0IjoxNzA0MDYwNzU4LCJleHAiOjE5MzY2NzY3NTh9.QMPQkwqJHqV7GkXKSH_PwVTANkVLZBQyN-OHW9OxGWI"

# Try to insert Twitter source
$headers = @{
    "Authorization" = "Bearer $anonKey"
    "Content-Type" = "application/json"
    "apikey" = $anonKey
}

$body = @{
    id = "twitter"
    label = "X API v2"
    status = "active"
} | ConvertTo-Json

try {
    $response = Invoke-RestMethod -Uri $url -Method Post -Headers $headers -Body $body
    Write-Host "Insert result: " $response
} catch {
    Write-Host "Error: $($_.Exception.Response.StatusCode)"
    if ($_.Exception.Response.StatusCode -eq 409) {
        Write-Host "Twitter source already exists (conflict)"
    }
}

# Now try to read sources
$readUrl = "https://ahdudpkosbzqmwignmzd.supabase.co/rest/v1/sources"
try {
    $sources = Invoke-RestMethod -Uri $readUrl -Headers $headers -Method Get
    $sources | ConvertTo-Json -Depth 3
} catch {
    Write-Host "Error reading sources: $($_.Exception.Message)"
}
