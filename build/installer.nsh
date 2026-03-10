!macro customInstall
  ; Register as a browser in Windows
  WriteRegStr SHCTX "Software\Clients\StartMenuInternet\SlimeBrowser" "" "Slime Browser"
  WriteRegStr SHCTX "Software\Clients\StartMenuInternet\SlimeBrowser\DefaultIcon" "" "$INSTDIR\Slime Browser.exe,0"
  WriteRegStr SHCTX "Software\Clients\StartMenuInternet\SlimeBrowser\shell\open\command" "" '"$INSTDIR\Slime Browser.exe"'

  ; Capabilities
  WriteRegStr SHCTX "Software\Clients\StartMenuInternet\SlimeBrowser\Capabilities" "ApplicationName" "Slime Browser"
  WriteRegStr SHCTX "Software\Clients\StartMenuInternet\SlimeBrowser\Capabilities" "ApplicationDescription" "Fast, minimal browser with built-in adblocker"
  WriteRegStr SHCTX "Software\Clients\StartMenuInternet\SlimeBrowser\Capabilities" "ApplicationIcon" "$INSTDIR\Slime Browser.exe,0"

  ; URL Associations
  WriteRegStr SHCTX "Software\Clients\StartMenuInternet\SlimeBrowser\Capabilities\URLAssociations" "http" "SlimeBrowserURL"
  WriteRegStr SHCTX "Software\Clients\StartMenuInternet\SlimeBrowser\Capabilities\URLAssociations" "https" "SlimeBrowserURL"

  ; File Associations
  WriteRegStr SHCTX "Software\Clients\StartMenuInternet\SlimeBrowser\Capabilities\FileAssociations" ".htm" "SlimeBrowserHTML"
  WriteRegStr SHCTX "Software\Clients\StartMenuInternet\SlimeBrowser\Capabilities\FileAssociations" ".html" "SlimeBrowserHTML"
  WriteRegStr SHCTX "Software\Clients\StartMenuInternet\SlimeBrowser\Capabilities\FileAssociations" ".shtml" "SlimeBrowserHTML"
  WriteRegStr SHCTX "Software\Clients\StartMenuInternet\SlimeBrowser\Capabilities\FileAssociations" ".xhtml" "SlimeBrowserHTML"
  WriteRegStr SHCTX "Software\Clients\StartMenuInternet\SlimeBrowser\Capabilities\FileAssociations" ".svg" "SlimeBrowserHTML"
  WriteRegStr SHCTX "Software\Clients\StartMenuInternet\SlimeBrowser\Capabilities\FileAssociations" ".webp" "SlimeBrowserHTML"
  WriteRegStr SHCTX "Software\Clients\StartMenuInternet\SlimeBrowser\Capabilities\FileAssociations" ".pdf" "SlimeBrowserHTML"

  ; Register in RegisteredApplications
  WriteRegStr SHCTX "Software\RegisteredApplications" "Slime Browser" "Software\Clients\StartMenuInternet\SlimeBrowser\Capabilities"

  ; URL Protocol handler
  WriteRegStr SHCTX "Software\Classes\SlimeBrowserURL" "" "Slime Browser URL"
  WriteRegStr SHCTX "Software\Classes\SlimeBrowserURL" "URL Protocol" ""
  WriteRegStr SHCTX "Software\Classes\SlimeBrowserURL\DefaultIcon" "" "$INSTDIR\Slime Browser.exe,0"
  WriteRegStr SHCTX "Software\Classes\SlimeBrowserURL\shell\open\command" "" '"$INSTDIR\Slime Browser.exe" "%1"'

  ; HTML file handler
  WriteRegStr SHCTX "Software\Classes\SlimeBrowserHTML" "" "Slime Browser HTML Document"
  WriteRegStr SHCTX "Software\Classes\SlimeBrowserHTML\DefaultIcon" "" "$INSTDIR\Slime Browser.exe,0"
  WriteRegStr SHCTX "Software\Classes\SlimeBrowserHTML\shell\open\command" "" '"$INSTDIR\Slime Browser.exe" "%1"'
!macroend

!macro customUnInstall
  ; Remove browser registration
  DeleteRegKey SHCTX "Software\Clients\StartMenuInternet\SlimeBrowser"
  DeleteRegKey SHCTX "Software\Classes\SlimeBrowserURL"
  DeleteRegKey SHCTX "Software\Classes\SlimeBrowserHTML"
  DeleteRegValue SHCTX "Software\RegisteredApplications" "Slime Browser"
!macroend
