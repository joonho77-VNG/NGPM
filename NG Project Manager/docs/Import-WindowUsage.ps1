param(
    [string]$WorkbookPath = 'C:\Users\j2chang\OneDrive - Superior Court of California County of Orange\Vision - Vision NG - Grouping\Vision NG - Pipeline Plan-CC.xlsx',
    [string]$CsvPath = 'C:\Users\j2chang\OneDrive - Superior Court of California County of Orange\Vision - Vision NG - Grouping\Usage.csv',
    [switch]$ValidateOnly
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
$namespace = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'

function Read-XmlPart($Archive, [string]$Name) {
    $reader = [System.IO.StreamReader]::new($Archive.GetEntry($Name).Open())
    try {
        $document = [System.Xml.XmlDocument]::new()
        $document.PreserveWhitespace = $true
        $document.LoadXml($reader.ReadToEnd())
        return ,$document
    }
    finally { $reader.Dispose() }
}

function Get-ColumnName([int]$Number) {
    $name = ''
    while ($Number -gt 0) {
        $Number--
        $name = [char](65 + ($Number % 26)) + $name
        $Number = [int][Math]::Floor($Number / 26)
    }
    return $name
}

function Get-ColumnNumber([string]$Name) {
    $number = 0
    foreach ($character in $Name.ToCharArray()) { $number = $number * 26 + [int]$character - 64 }
    return $number
}

function Get-CellValue($Cell) {
    if ($null -eq $Cell) { return '' }
    if ($Cell.GetAttribute('t') -eq 's') { return $sharedStrings[[int]$Cell.v] }
    if ($Cell.GetAttribute('t') -eq 'inlineStr') {
        return ($Cell.SelectNodes('.//*[local-name()="t"]') | ForEach-Object { $_.InnerText }) -join ''
    }
    return [string]$Cell.v
}

function Get-PartHash($Entry) {
    $stream = $Entry.Open()
    $algorithm = [System.Security.Cryptography.SHA256]::Create()
    try { return [Convert]::ToBase64String($algorithm.ComputeHash($stream)) }
    finally { $stream.Dispose(); $algorithm.Dispose() }
}

$usageRows = @(Import-Csv -LiteralPath $CsvPath)
if ($usageRows.Count -eq 0) { throw 'The CSV has no usage rows.' }
foreach ($header in @('WINDOW_OBJECT', 'USER_PROFILE', 'USAGE_COUNT')) {
    if ($header -notin $usageRows[0].PSObject.Properties.Name) { throw "Missing CSV column: $header" }
}
$countsByObject = @{}
foreach ($usageRow in $usageRows) {
    $objectName = $usageRow.WINDOW_OBJECT.Trim()
    $profile = $usageRow.USER_PROFILE.Trim()
    if ($objectName -cnotmatch '^w_[a-z0-9_]+$' -or $profile -cnotmatch '^[a-z0-9_]+$') {
        throw 'Invalid CSV object name or profile.'
    }
    [long]$count = 0
    if (-not [long]::TryParse($usageRow.USAGE_COUNT, [ref]$count) -or $count -lt 0 -or $count -gt 9007199254740991) {
        throw "Invalid usage count for $objectName / $profile"
    }
    if (-not $countsByObject.ContainsKey($objectName)) { $countsByObject[$objectName] = @{} }
    if ($countsByObject[$objectName].ContainsKey($profile)) { throw "Duplicate result: $objectName / $profile" }
    $countsByObject[$objectName][$profile] = $count
}
$profiles = @($usageRows | ForEach-Object { $_.USER_PROFILE.Trim() } | Sort-Object -Unique)
$headers = @('Total Usage') + $profiles
$plans = @()
$workbookObjects = @{}
$partHashes = @{}
$originalHash = (Get-FileHash -LiteralPath $WorkbookPath -Algorithm SHA256).Hash
$archive = [System.IO.Compression.ZipFile]::OpenRead($WorkbookPath)
try {
    foreach ($entry in $archive.Entries) { $partHashes[$entry.FullName] = Get-PartHash $entry }
    $sharedXml = Read-XmlPart $archive 'xl/sharedStrings.xml'
    $sharedStrings = @($sharedXml.SelectNodes('//*[local-name()="si"]') | ForEach-Object { ($_.SelectNodes('.//*[local-name()="t"]') | ForEach-Object { $_.InnerText }) -join '' })
    $book = Read-XmlPart $archive 'xl/workbook.xml'
    $relationships = Read-XmlPart $archive 'xl/_rels/workbook.xml.rels'
    foreach ($sheet in $book.SelectNodes('//*[local-name()="sheet"]')) {
        if ($sheet.name -notin @('Pipeline - OPS', 'Pipeline with LOE')) { continue }
        $relationshipId = $sheet.GetAttribute('id', 'http://schemas.openxmlformats.org/officeDocument/2006/relationships')
        $target = ($relationships.SelectNodes('//*[local-name()="Relationship"]') | Where-Object { $_.Id -eq $relationshipId }).Target
        $partName = if ($target.StartsWith('/')) { $target.TrimStart('/') } else { 'xl/' + $target }
        $document = Read-XmlPart $archive $partName
        $originalXml = $document.OuterXml
        $root = $document.DocumentElement
        $sheetData = $root.SelectSingleNode('./*[local-name()="sheetData"]')
        $headerRow = $sheetData.SelectSingleNode('./*[local-name()="row" and @r="1"]')
        $objectHeader = $headerRow.SelectSingleNode('./*[local-name()="c" and @r="E1"]')
        if ((Get-CellValue $objectHeader) -ne 'OBJECT NAME') { throw "Column E header changed in $($sheet.name)." }
        foreach ($cell in $headerRow.ChildNodes) {
            if ((Get-CellValue $cell) -eq 'Total Usage') { throw "Usage columns already exist in $($sheet.name)." }
        }
        $dimension = $root.SelectSingleNode('./*[local-name()="dimension"]')
        if ($dimension.ref -notmatch ':([A-Z]+)(\d+)$') { throw 'Unsupported worksheet dimension.' }
        $lastColumn = Get-ColumnNumber $Matches[1]
        $lastRow = [int]$Matches[2]
        $newLastColumn = $lastColumn + $headers.Count
        $newLastName = Get-ColumnName $newLastColumn
        $dimension.SetAttribute('ref', "A1:$newLastName$lastRow")
        $columns = $root.SelectSingleNode('./*[local-name()="cols"]')
        if ($null -eq $columns) { throw 'Missing column definitions.' }
        foreach ($column in @($columns.ChildNodes)) {
            if ([int]$column.min -le $lastColumn -and [int]$column.max -gt $lastColumn) { throw 'Column definition crosses the append boundary.' }
            if ([int]$column.min -gt $lastColumn) {
                if ([int]$column.max -gt $newLastColumn) { $column.SetAttribute('min', [string]($newLastColumn + 1)) }
                else { $columns.RemoveChild($column) | Out-Null }
            }
        }
        $newColumn = $document.CreateElement('col', $namespace)
        $newColumn.SetAttribute('min', [string]($lastColumn + 1))
        $newColumn.SetAttribute('max', [string]$newLastColumn)
        $newColumn.SetAttribute('width', '22')
        $newColumn.SetAttribute('customWidth', '1')
        $followingColumn = @($columns.ChildNodes | Where-Object { [int]$_.min -gt $newLastColumn }) | Select-Object -First 1
        if ($followingColumn) { $columns.InsertBefore($newColumn, $followingColumn) | Out-Null }
        else { $columns.AppendChild($newColumn) | Out-Null }
        $filter = $root.SelectSingleNode('./*[local-name()="autoFilter"]')
        if ($filter -and $filter.ref -match '^([A-Z]+\d+):[A-Z]+(\d+)$') {
            $filter.SetAttribute('ref', "$($Matches[1]):$newLastName$($Matches[2])")
        }
        $expected = @{}
        $objectRows = 0
        $zeroRows = 0
        foreach ($row in $sheetData.ChildNodes) {
            $rowNumber = [int]$row.r
            if ($rowNumber -eq 1) { $values = $headers }
            else {
                $objectCell = $row.SelectSingleNode('./*[local-name()="c" and @r="E' + $rowNumber + '"]')
                $objectName = (Get-CellValue $objectCell).Trim()
                if ([string]::IsNullOrWhiteSpace($objectName)) { continue }
                if ($objectName -cnotmatch '^w_[a-z0-9_]+$') { throw "Invalid object in $($sheet.name), row $rowNumber" }
                $workbookObjects[$objectName] = $true
                $objectRows++
                $values = @(0)
                [long]$total = 0
                foreach ($profile in $profiles) {
                    [long]$count = 0
                    if ($countsByObject.ContainsKey($objectName) -and $countsByObject[$objectName].ContainsKey($profile)) {
                        $count = $countsByObject[$objectName][$profile]
                    }
                    $values += $count
                    $total += $count
                }
                if ($total -gt 9007199254740991) { throw "Total exceeds Excel numeric precision: $objectName" }
                $values[0] = $total
                if ($total -eq 0) { $zeroRows++ }
            }
            for ($valueIndex = 0; $valueIndex -lt $values.Count; $valueIndex++) {
                $address = (Get-ColumnName ($lastColumn + 1 + $valueIndex)) + $rowNumber
                $cell = $document.CreateElement('c', $namespace)
                $cell.SetAttribute('r', $address)
                if ($rowNumber -eq 1) {
                    $cell.SetAttribute('t', 'inlineStr')
                    if ($objectHeader.HasAttribute('s')) { $cell.SetAttribute('s', $objectHeader.GetAttribute('s')) }
                    $inlineString = $document.CreateElement('is', $namespace)
                    $text = $document.CreateElement('t', $namespace)
                    $text.InnerText = [string]$values[$valueIndex]
                    $inlineString.AppendChild($text) | Out-Null
                    $cell.AppendChild($inlineString) | Out-Null
                }
                else {
                    $valueNode = $document.CreateElement('v', $namespace)
                    $valueNode.InnerText = [string]$values[$valueIndex]
                    $cell.AppendChild($valueNode) | Out-Null
                }
                $row.AppendChild($cell) | Out-Null
                $expected[$address] = [string]$values[$valueIndex]
            }
            if ($row.HasAttribute('spans')) { $row.SetAttribute('spans', "1:$newLastColumn") }
        }
        $plans += [PSCustomObject]@{ Name = [string]$sheet.name; PartName = $partName; Document = $document; OriginalXml = $originalXml; Expected = $expected; ObjectRows = $objectRows; ZeroRows = $zeroRows; UsageRange = (Get-ColumnName ($lastColumn + 1)) + ':' + $newLastName }
    }
}
finally { $archive.Dispose() }
if ($plans.Count -ne 2) { throw 'Both pipeline sheets must be present.' }
foreach ($objectName in $countsByObject.Keys) {
    if (-not $workbookObjects.ContainsKey($objectName)) { throw "CSV object not found in workbook: $objectName" }
}
Write-Output "Validated $($usageRows.Count) CSV rows, $($profiles.Count) profiles, and $($workbookObjects.Count) distinct workbook objects."
$plans | Select-Object Name, ObjectRows, ZeroRows, UsageRange | Format-Table
if ($ValidateOnly) { return }

$folder = [System.IO.Path]::GetDirectoryName($WorkbookPath)
$baseName = [System.IO.Path]::GetFileNameWithoutExtension($WorkbookPath)
$backupPath = Join-Path $folder ($baseName + '.before-usage-' + (Get-Date -Format 'yyyyMMdd-HHmmss-fff') + '.xlsx')
$temporaryPath = Join-Path $folder ($baseName + '.usage-working-' + [Guid]::NewGuid().ToString('N') + '.xlsx')
Copy-Item -LiteralPath $WorkbookPath -Destination $backupPath
Write-Output "Backup: $backupPath"
try {
    Copy-Item -LiteralPath $backupPath -Destination $temporaryPath
    $archive = [System.IO.Compression.ZipFile]::Open($temporaryPath, [System.IO.Compression.ZipArchiveMode]::Update)
    try {
        foreach ($plan in $plans) {
            $archive.GetEntry($plan.PartName).Delete()
            $entry = $archive.CreateEntry($plan.PartName)
            $stream = $entry.Open()
            try { $plan.Document.Save($stream) }
            finally { $stream.Dispose() }
        }
    }
    finally { $archive.Dispose() }
    $archive = [System.IO.Compression.ZipFile]::OpenRead($temporaryPath)
    try {
        if ($archive.Entries.Count -ne $partHashes.Count) { throw 'Workbook package entry count changed.' }
        foreach ($entry in $archive.Entries) {
            if ($entry.FullName -notin $plans.PartName -and (Get-PartHash $entry) -cne $partHashes[$entry.FullName]) {
                throw "Unrelated workbook part changed: $($entry.FullName)"
            }
        }
        foreach ($plan in $plans) {
            $saved = Read-XmlPart $archive $plan.PartName
            $savedData = $saved.DocumentElement.SelectSingleNode('./*[local-name()="sheetData"]')
            foreach ($address in $plan.Expected.Keys) {
                $cell = $savedData.SelectSingleNode('.//*[local-name()="c" and @r="' + $address + '"]')
                if ((Get-CellValue $cell) -cne $plan.Expected[$address]) { throw "Saved value mismatch: $($plan.Name)!$address" }
                $cell.ParentNode.RemoveChild($cell) | Out-Null
            }
            $original = [System.Xml.XmlDocument]::new()
            $original.PreserveWhitespace = $true
            $original.LoadXml($plan.OriginalXml)
            foreach ($row in $savedData.ChildNodes) {
                $originalRow = $original.DocumentElement.SelectSingleNode('./*[local-name()="sheetData"]/*[local-name()="row" and @r="' + $row.r + '"]')
                if ($originalRow.HasAttribute('spans')) { $row.SetAttribute('spans', $originalRow.GetAttribute('spans')) }
            }
            foreach ($elementName in @('dimension', 'cols', 'autoFilter')) {
                $oldNode = $original.DocumentElement.SelectSingleNode('./*[local-name()="' + $elementName + '"]')
                $newNode = $saved.DocumentElement.SelectSingleNode('./*[local-name()="' + $elementName + '"]')
                if ($oldNode) { $saved.DocumentElement.ReplaceChild($saved.ImportNode($oldNode, $true), $newNode) | Out-Null }
            }
            if ($saved.OuterXml -cne $original.OuterXml) { throw "Original worksheet content changed: $($plan.Name)" }
        }
    }
    finally { $archive.Dispose() }
    if ((Get-FileHash -LiteralPath $WorkbookPath -Algorithm SHA256).Hash -cne $originalHash) {
        throw 'Original workbook changed during the import; refusing to overwrite it.'
    }
    Copy-Item -LiteralPath $temporaryPath -Destination $WorkbookPath -Force
    if ((Get-FileHash -LiteralPath $WorkbookPath -Algorithm SHA256).Hash -cne (Get-FileHash -LiteralPath $temporaryPath -Algorithm SHA256).Hash) {
        throw 'Final workbook does not match the verified temporary copy.'
    }
    Write-Output 'PASS: All saved usage cells match the CSV; original worksheet content and every other workbook part are unchanged.'
    Write-Output "Updated: $WorkbookPath"
}
finally {
    if (Test-Path -LiteralPath $temporaryPath) { Remove-Item -LiteralPath $temporaryPath }
}