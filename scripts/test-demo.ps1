# Pre-record sanity check for the /demo/ask endpoint.
# Run from anywhere with: powershell -File scripts\test-demo.ps1
# Or from inside the matchmesh folder: .\scripts\test-demo.ps1

$body = @{ question = "how is Brazil doing?" } | ConvertTo-Json

try {
    $response = Invoke-RestMethod -Uri "https://matchmesh.onrender.com/demo/ask" -Method Post -ContentType "application/json" -Body $body
    Write-Host ""
    Write-Host "OK - demo endpoint responded:" -ForegroundColor Green
    Write-Host ("Answer:     " + $response.answer)
    Write-Host ("Settled tx: " + $response.settledTx)
    Write-Host ("Price USD:  " + $response.priceUsd)
    Write-Host ""
    Write-Host "Safe to record." -ForegroundColor Green
}
catch {
    Write-Host ""
    Write-Host "NOT OK - demo endpoint failed:" -ForegroundColor Red
    Write-Host $_.ErrorDetails.Message
    Write-Host ""
    Write-Host "If this mentions 'daily spend cap reached', wait for the window to reset or raise MCP_DAILY_BUDGET_USD on Render and redeploy." -ForegroundColor Yellow
}
