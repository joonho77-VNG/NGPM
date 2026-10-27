# Appends rows to one QA defect log through Excel, so dropdowns, conditional formats and every
# other sheet survive untouched. Called by uatsync.js with a job file:
#   { file, fmtFrom, rows: [ { row, cells: [ {col, val, kind: text|number|date} ] } ] }
# Each new row takes its formatting and validation from row fmtFrom (the last real defect).
param([string]$JobPath)
$ErrorActionPreference = 'Stop'
$job = Get-Content -Raw -Encoding UTF8 $JobPath | ConvertFrom-Json
$xl = $null; $wb = $null
try {
  $xl = New-Object -ComObject Excel.Application
  $xl.Visible = $false; $xl.DisplayAlerts = $false; $xl.AskToUpdateLinks = $false
  $wb = $xl.Workbooks.Open($job.file, 0, $false)
  if ($wb.ReadOnly) { throw "opened read-only (someone else has it open)" }
  $ws = $wb.Worksheets.Item('DEFECTS')
  foreach ($r in $job.rows) {
    # Copy straight to the destination (no clipboard), then drop the copied values:
    # formats and validation stay, content is filled in below.
    $ws.Rows([int]$job.fmtFrom).Copy($ws.Rows([int]$r.row)) | Out-Null
    $ws.Rows([int]$r.row).ClearContents() | Out-Null
    foreach ($c in $r.cells) {
      $cell = $ws.Cells.Item([int]$r.row, [int]$c.col)
      switch ($c.kind) {
        'date'   { $cell.Value2 = ([datetime]::ParseExact($c.val, 'yyyy-MM-dd', $null)).ToOADate() }
        'number' { $cell.Value2 = [double]$c.val }
        default  { $cell.Value2 = [string]$c.val }
      }
    }
    $ws.Rows([int]$r.row).AutoFit() | Out-Null
  }
  $wb.Save()
  Write-Output "OK $($job.rows.Count) row(s)"
} catch {
  Write-Output "ERR $($_.Exception.Message)"
} finally {
  if ($wb) { $wb.Close($false) }
  if ($xl) { $xl.Quit(); [void][Runtime.InteropServices.Marshal]::ReleaseComObject($xl) }
}
