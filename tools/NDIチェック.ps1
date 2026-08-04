# LED STAGE IMAGER / NDI 出し 朝イチチェック
# 2026-07-15 作成。ダブルクリック（NDIチェック.bat）で実行。
# 「NDIが映らない」時に、原因を5秒で切り分けるためのツール。

$ErrorActionPreference = 'SilentlyContinue'
$ok = @(); $ng = @(); $warn = @()

function Line($t){ Write-Host $t }
function Head($t){ Write-Host ''; Write-Host ('=== ' + $t + ' ===') -ForegroundColor Cyan }

Write-Host ''
Write-Host '  LED STAGE IMAGER / NDI 朝イチチェック' -ForegroundColor White
Write-Host '  ------------------------------------' -ForegroundColor DarkGray

# ---------- 1. 有線の住所（最重要。2026-07-15 の元凶はここだった） ----------
Head '1. 有線ネットワークの住所'
$nic = Get-NetAdapter | Where-Object { $_.Status -eq 'Up' -and $_.InterfaceDescription -like '*BUFFALO*' } | Select-Object -First 1
if (-not $nic) { $nic = Get-NetAdapter | Where-Object { $_.Status -eq 'Up' -and ($_.Name -like '*イーサネット*' -or $_.Name -like '*Ethernet*') } | Select-Object -First 1 }
if (-not $nic) {
  Line '  [NG] 有線がどこも繋がってません（ケーブル抜け？）'
  $ng += '有線リンクなし → LANケーブルを挿してください'
} else {
  Line ('  口: ' + $nic.Name + '  (' + $nic.LinkSpeed + ')')
  $addr = Get-NetIPAddress -InterfaceIndex $nic.ifIndex -AddressFamily IPv4 | Where-Object { $_.IPAddress -notlike '169.254*' } | Select-Object -First 1
  if (-not $addr) {
    Line '  [NG] 有線に有効な住所がありません（169.254の仮ナンバーだけ）'
    $ng += '有線の住所が無い → 下の「住所の直し方」を実行'
  } elseif ($addr.AddressState -eq 'Duplicate') {
    Line ('  [NG] 住所 ' + $addr.IPAddress + ' が Duplicate（重複）！') -ForegroundColor Red
    Line '       ★これが2026-07-15に2日間ハマった元凶と同じ症状です'
    Line '       会場の別の機材が同じ番号を使っています。Windowsがこの住所を'
    Line '       没収したので、このPCは有線ネットで一言も喋れません。'
    $ng += ('住所 ' + $addr.IPAddress + ' が他機材とカブってる → 空き番号へ引っ越し（下記）')
  } else {
    Line ('  [OK] 住所 ' + $addr.IPAddress + ' / ' + $addr.AddressState + ' （正常）')
    $ok += ('有線 ' + $addr.IPAddress + ' 正常')
  }
  # 仮ナンバーの同居チェック（Duplicateの前兆）
  $apipa = Get-NetIPAddress -InterfaceIndex $nic.ifIndex -AddressFamily IPv4 | Where-Object { $_.IPAddress -like '169.254*' }
  if ($apipa) {
    Line ('  [警告] 仮ナンバー ' + $apipa.IPAddress + ' が同居 → 住所が死にかけのサイン')
    $warn += '169.254の仮ナンバーが出てる → 住所が無効化されてる可能性'
  }
}

# ---------- 2. どのNDIを使っているか（2番目の元凶） ----------
# 2026-07-27 更新: アプリ側で読み込み順を「正規ランタイム → 最後に同梱DLL」に直した
# （ビルド 68bf3ee 以降）。なので同梱DLLが在ること自体はもう問題ではない＝
# 以前やっていた「.bundled-off にリネームして隠す」対処はもう要らない。
# 見るべきは「正規ランタイムが入っているか」だけ。入っていれば必ずそちらが使われる。
Head '2. NDIランタイム（正規が入っているか）'
$bundled = Join-Path $env:LOCALAPPDATA 'Programs\decor-studio\resources\app.asar.unpacked\resources\ndi\Processing.NDI.Lib.x64.dll'
$official = @(
  $env:NDI_RUNTIME_DIR_V6,
  $env:NDI_RUNTIME_DIR_V5,
  'C:\Program Files\NDI\NDI 6 Tools\Runtime',
  'C:\Program Files\NDI\NDI 6 Runtime\v6',
  'C:\Program Files\NDI\NDI 5 Runtime\v5'
) | Where-Object { $_ -and (Test-Path (Join-Path $_ 'Processing.NDI.Lib.x64.dll')) } | Select-Object -First 1

if ($official) {
  Line ('  [OK] 正規NDIランタイムあり: ' + $official)
  Line '       アプリはこちらを優先して読みます（送信する回線を固定できます）'
  $ok += '正規NDIランタイム導入済み（回線固定が効く）'
} else {
  Line '  [NG] 正規NDIランタイムが見つかりません'
  Line '       このままだとアプリは同梱DLLに落ちます。動きはしますが、'
  Line '       NDI Access Manager の「送信する回線の固定」が一切効かないので、'
  Line '       回線が複数ある会場では Resolume から見つからないことがあります。'
  $ng += 'NDI Tools が入ってない → https://ndi.video/tools/ から導入（回線を固定するため）'
}
if (Test-Path $bundled) {
  Line '  (参考) アプリ同梱DLLもあります＝正規が無いPCでも動く保険。隠す必要はありません'
} else {
  Line '  (参考) アプリ同梱DLLは見当たりません（正規ランタイムが必須になります）'
}

# ---------- 3. Bonjour（NDIの発見を邪魔する） ----------
Head '3. Bonjour（NDIの発見を邪魔する常駐）'
$bj = Get-Service 'Bonjour Service'
if (-not $bj) { Line '  [OK] Bonjour は未インストール'; $ok += 'Bonjourなし' }
elseif ($bj.Status -eq 'Stopped' -and $bj.StartType -eq 'Disabled') { Line '  [OK] Bonjour = 停止＋無効（正常）'; $ok += 'Bonjour無効' }
else { Line ('  [警告] Bonjour = ' + $bj.Status + ' / ' + $bj.StartType + ' → NDIの発見を邪魔する可能性'); $warn += 'Bonjourが動いてる → 無効化を検討' }

# ---------- 4. アプリとNDI送出 ----------
Head '4. アプリ（LED STAGE IMAGER）とNDI送出'
$app = Get-Process decor-studio
if (-not $app) { Line '  [NG] アプリが起動していません'; $ng += 'アプリを起動してください' }
else {
  Line ('  [OK] アプリ稼働中（' + ($app | Measure-Object).Count + 'プロセス）')
  $ok += 'アプリ稼働中'
  $listen = Get-NetTCPConnection -LocalPort 5960 -State Listen
  if ($listen) { Line '  [OK] NDI送出ポート(5960) 待受中'; $ok += 'NDI送出中' }
  else { Line '  [NG] NDIが送出していません'; $ng += 'NDIが出てない → アプリを再起動' }
  # NDIがどのネットワークに名乗っているか
  $binds = Get-NetUDPEndpoint -LocalPort 5353 | ForEach-Object {
    $pn = (Get-Process -Id $_.OwningProcess).ProcessName
    if ($pn -eq 'decor-studio') { $_.LocalAddress }
  } | Where-Object { $_ -notlike '127.*' -and $_ -ne '0.0.0.0' -and $_ -notlike '::*' }
  if ($binds) { Line ('  NDIが名乗ってる網: ' + ($binds -join ', ')) }
}

# ---------- 5. 相手（Resolume等）に届くか ----------
Head '5. 相手の機材に届くか'
if ($addr -and $addr.AddressState -eq 'Preferred') {
  $seg = ($addr.IPAddress -split '\.')[0..2] -join '.'
  Line ('  ' + $seg + '.0/24 を探索中…')
  $null = 1..254 | ForEach-Object { (New-Object System.Net.NetworkInformation.Ping).SendPingAsync(($seg + '.' + $_), 150) }
  Start-Sleep -Seconds 4
  $found = Get-NetNeighbor -InterfaceIndex $nic.ifIndex -AddressFamily IPv4 |
    Where-Object { $_.IPAddress -like ($seg + '.*') -and $_.LinkLayerAddress -match '^[0-9A-Fa-f]{2}-' -and $_.LinkLayerAddress -ne 'FF-FF-FF-FF-FF-FF' -and $_.State -in 'Reachable','Stale' }
  if ($found) {
    Line ('  [OK] ' + ($found | Measure-Object).Count + ' 台の機材が見えます:')
    $found | Sort-Object { [int]($_.IPAddress -split '\.')[3] } | ForEach-Object { Line ('       ' + $_.IPAddress) }
    $ok += '相手の機材が見えてる'
  } else {
    Line '  [NG] 誰も見えません（自分だけ）'
    $ng += '同じ網に誰も居ない → ケーブルの行き先を確認'
  }
} else {
  Line '  (住所が無効なのでスキップ)'
}

# ---------- 判定 ----------
Write-Host ''
Write-Host '========================================' -ForegroundColor DarkGray
if ($ng.Count -eq 0 -and $warn.Count -eq 0) {
  Write-Host '  結果: すべてOK。そのまま本番へ' -ForegroundColor Green
} elseif ($ng.Count -eq 0) {
  Write-Host '  結果: 動くはずだが、注意あり' -ForegroundColor Yellow
} else {
  Write-Host '  結果: 問題あり。下を直してください' -ForegroundColor Red
}
Write-Host '========================================' -ForegroundColor DarkGray
if ($ng.Count -gt 0) { Write-Host ''; Write-Host '【要対応】' -ForegroundColor Red; $ng | ForEach-Object { Write-Host ('  ・' + $_) } }
if ($warn.Count -gt 0) { Write-Host ''; Write-Host '【注意】' -ForegroundColor Yellow; $warn | ForEach-Object { Write-Host ('  ・' + $_) } }

# ---------- 直し方 ----------
if ($ng.Count -gt 0 -or $warn.Count -gt 0) {
  Write-Host ''
  Write-Host '--- 直し方（PowerShellを「管理者として実行」して貼る）---' -ForegroundColor Cyan
  Write-Host ''
  Write-Host '■ 住所がDuplicate（カブってる）時 → 空き番号へ引っ越し'
  Write-Host '  ※下の 200 の部分を、上の一覧に出てない番号に変えてください'
  Write-Host ('  Remove-NetIPAddress -InterfaceIndex ' + $(if($nic){$nic.ifIndex}else{'8'}) + ' -Confirm:$false')
  Write-Host ('  New-NetIPAddress -InterfaceIndex ' + $(if($nic){$nic.ifIndex}else{'8'}) + ' -IPAddress 192.168.46.200 -PrefixLength 24')
  Write-Host ''
  Write-Host '■ 正規NDIランタイムが無い時 → NDI Tools を入れる'
  Write-Host '  https://ndi.video/tools/ から NDI Tools をインストール（無料）。'
  Write-Host '  入れたらアプリを再起動。以後 NDI Access Manager で送信回線を固定できます。'
  Write-Host '  ※ 同梱DLLを .bundled-off に隠す対処は、もう不要です'
  Write-Host '    （2026-07-27 のビルドから、正規ランタイムを先に読むよう直しました）'
  Write-Host ''
  Write-Host '■ Bonjourが動いてる時 → 止めて無効化'
  Write-Host '  Get-Service Bonjour* | Set-Service -StartupType Disabled'
  Write-Host '  Get-Service Bonjour* | Stop-Service -Force'
}

Write-Host ''
Write-Host '（詳しい手順は「LED-STAGE-IMAGER-Windows現場手順」を参照）' -ForegroundColor DarkGray
Write-Host ''
Write-Host 'Enterキーで閉じます...'
Read-Host
