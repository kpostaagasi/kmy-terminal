; Windows: imzasız NSIS kurulum dosyası → dist/kmy-terminal-<sürüm>-x64-setup.exe
; makensis /DVERSION=0.23.0 /DSRC=dist\win packaging\windows\kmy-terminal.nsi
Unicode true
Name "kmy terminal ${VERSION}"
OutFile "..\..\dist\kmy-terminal-${VERSION}-x64-setup.exe"
InstallDir "$LOCALAPPDATA\Programs\kmy terminal"
RequestExecutionLevel user
Page directory
Page instfiles
Section
  SetOutPath "$INSTDIR"
  File /r "..\..\${SRC}\*.*"
  CreateDirectory "$SMPROGRAMS\kmy terminal"
  CreateShortCut "$SMPROGRAMS\kmy terminal\kmy terminal.lnk" "$INSTDIR\node.exe" '"$INSTDIR\app\bin\start.mjs"'
  CreateShortCut "$DESKTOP\kmy terminal.lnk" "$INSTDIR\node.exe" '"$INSTDIR\app\bin\start.mjs"'
  WriteUninstaller "$INSTDIR\uninstall.exe"
  CreateShortCut "$SMPROGRAMS\kmy terminal\Kaldır.lnk" "$INSTDIR\uninstall.exe"
SectionEnd
Section "Uninstall"
  Delete "$DESKTOP\kmy terminal.lnk"
  RMDir /r "$SMPROGRAMS\kmy terminal"
  RMDir /r "$INSTDIR"
SectionEnd
