!macro customUnInstall
  StrCpy $1 ""
  FileOpen $0 "$APPDATA\bd.myai.app\windows-brand-shortcut.txt" r
  IfErrors +3
    FileRead $0 $1
    FileClose $0
  ${If} $1 != ""
    Delete "$1"
  ${EndIf}
  Delete "$APPDATA\bd.myai.app\windows-brand-shortcut.txt"
!macroend
