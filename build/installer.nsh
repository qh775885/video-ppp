Function .onVerifyInstDir
  StrLen $0 "$INSTDIR"

  StrCmp $0 2 maybeDrive done
  StrCmp $0 3 maybeDriveSlash done
  Goto done

maybeDrive:
  StrCpy $1 "$INSTDIR" 1 1
  StrCmp $1 ":" 0 done
  StrCpy $INSTDIR "$INSTDIR\${APP_PRODUCT_FILENAME}"
  Goto done

maybeDriveSlash:
  StrCpy $1 "$INSTDIR" 1 1
  StrCmp $1 ":" 0 done
  StrCpy $2 "$INSTDIR" 1 2
  StrCmp $2 "\" 0 done
  StrCpy $INSTDIR "$INSTDIR${APP_PRODUCT_FILENAME}"

done:
FunctionEnd
