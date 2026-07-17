$env:ELECTRON_RUN_AS_NODE = ""
Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
Remove-Item Env:VSCODE_ESM_ENTRYPOINT -ErrorAction SilentlyContinue

Write-Host "Launching Electron app..."
Write-Host "CWD: $(Get-Location)"

# Build first
npm run build 2>&1

# Then launch electron
npx electron . 2>&1
