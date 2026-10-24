# R8 rules for LifeScript (Capacitor 8 WebView shell).
# The app loads the live site in a WebView, so the JS <-> native bridge and the
# Capacitor plugins are found by annotation/reflection and must not be renamed
# or stripped. @capacitor/android already ships similar consumer rules; they are
# repeated here on purpose so a Capacitor upgrade can't silently drop them.

# JS bridge: methods exposed to the WebView via addJavascriptInterface
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}
-keep class com.getcapacitor.MessageHandler { *; }

# Capacitor plugins (app, browser, filesystem, share, splash-screen, status-bar, toast)
-keep @com.getcapacitor.annotation.CapacitorPlugin public class * {
    @com.getcapacitor.annotation.PermissionCallback <methods>;
    @com.getcapacitor.annotation.ActivityCallback <methods>;
    @com.getcapacitor.annotation.Permission <methods>;
    @com.getcapacitor.PluginMethod public <methods>;
}
-keep public class * extends com.getcapacitor.Plugin { *; }
-keep @com.getcapacitor.NativePlugin public class * {
    @com.getcapacitor.PluginMethod public <methods>;
}
-keep public class * extends org.apache.cordova.* {
    public <methods>;
    public <fields>;
}

# Readable crash stack traces in Play Console (mapping.txt is uploaded with the AAB)
-keepattributes SourceFile,LineNumberTable,*Annotation*
-renamesourcefileattribute SourceFile
