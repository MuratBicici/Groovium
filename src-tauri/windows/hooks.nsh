; Groovium in Windows' "Open with" list for audio files.
;
; Offered, never imposed: the types get Groovium as one more program that can
; open them (OpenWithProgids, and the Applications entry "Open with" lists),
; and whatever opens them now still does. Tauri's own `fileAssociations`
; would make Groovium their default, taking a music player away from someone
; who only installed a widget.
;
; The extensions are AUDIO_EXTENSIONS in src/library.rs; a test there checks
; that every one of them is here.

!define GROOVIUM_PROGID "Groovium.AudioFile"
!define GROOVIUM_APP "Software\Classes\Applications\${MAINBINARYNAME}.exe"

!macro GROOVIUM_OFFER EXT
  WriteRegStr SHCTX "Software\Classes\.${EXT}\OpenWithProgids" "${GROOVIUM_PROGID}" ""
  WriteRegStr SHCTX "${GROOVIUM_APP}\SupportedTypes" ".${EXT}" ""
!macroend

!macro GROOVIUM_WITHDRAW EXT
  DeleteRegValue SHCTX "Software\Classes\.${EXT}\OpenWithProgids" "${GROOVIUM_PROGID}"
!macroend

!macro GROOVIUM_EACH MACRO
  !insertmacro ${MACRO} "mp3"
  !insertmacro ${MACRO} "flac"
  !insertmacro ${MACRO} "wav"
  !insertmacro ${MACRO} "ogg"
  !insertmacro ${MACRO} "oga"
  !insertmacro ${MACRO} "opus"
  !insertmacro ${MACRO} "m4a"
  !insertmacro ${MACRO} "aac"
  !insertmacro ${MACRO} "weba"
  !insertmacro ${MACRO} "webm"
  !insertmacro ${MACRO} "mp4"
  !insertmacro ${MACRO} "m4b"
  !insertmacro ${MACRO} "mka"
!macroend

!macro NSIS_HOOK_POSTINSTALL
  WriteRegStr SHCTX "Software\Classes\${GROOVIUM_PROGID}" "" "Audio file"
  WriteRegStr SHCTX "Software\Classes\${GROOVIUM_PROGID}\DefaultIcon" "" "$INSTDIR\${MAINBINARYNAME}.exe,0"
  WriteRegStr SHCTX "Software\Classes\${GROOVIUM_PROGID}\shell\open\command" "" '"$INSTDIR\${MAINBINARYNAME}.exe" "%1"'
  WriteRegStr SHCTX "${GROOVIUM_APP}" "FriendlyAppName" "${PRODUCTNAME}"
  WriteRegStr SHCTX "${GROOVIUM_APP}\shell\open\command" "" '"$INSTDIR\${MAINBINARYNAME}.exe" "%1"'
  !insertmacro GROOVIUM_EACH GROOVIUM_OFFER
  ; Explorer reads associations once; tell it they changed.
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  !insertmacro GROOVIUM_EACH GROOVIUM_WITHDRAW
  DeleteRegKey SHCTX "${GROOVIUM_APP}"
  DeleteRegKey SHCTX "Software\Classes\${GROOVIUM_PROGID}"
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
!macroend
