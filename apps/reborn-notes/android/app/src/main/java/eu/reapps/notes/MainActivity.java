package eu.reapps.notes;

import android.content.res.Configuration;
import android.graphics.Color;
import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    // App's real surface tokens (packages/ui global.css --background): #ffffff
    // light, oklch(0.145 0 0) ~= #0a0a0a dark. Kept in sync with the splash
    // @color (values/colors.xml) and the app.html loader background.
    private static final int BACKGROUND_LIGHT = Color.parseColor("#ffffff");
    private static final int BACKGROUND_DARK = Color.parseColor("#0a0a0a");

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Register the app-local FolderFs plugin (native folder sync, disk -> app)
        // BEFORE super.onCreate so the bridge wires it up during initialization.
        // This is the Android counterpart of iOS
        // MainViewController.capacitorDidLoad(); add future app-local plugins here
        // the same way.
        registerPlugin(FolderFsPlugin.class);
        super.onCreate(savedInstanceState);

        // Close the white WebView frame between the splash dismissing and the web
        // content's first paint. Capacitor never sets a background color on the
        // WebView or the window, so a cold start flashes the default white window
        // there - jarring for a system-dark launch, where both the splash and the
        // loaded app are dark. Paint the window + WebView in the app's real
        // --background for the current system scheme (the same #ffffff / #0a0a0a
        // the DayNight splash @color and the app.html loader use), so the whole
        // splash -> loader -> content hand-off stays one shade. This follows the
        // OS scheme like the splash does; a user who pinned a theme against the
        // system gets the exact color a sub-frame later when the web layer's
        // applyTheme runs. See guideline 61.
        applyThemedBackground(getResources().getConfiguration());
    }

    @Override
    public void onConfigurationChanged(Configuration newConfig) {
        // Fires (instead of an activity recreate) when uiMode is in the
        // manifest's configChanges - keep the frame color correct across a live
        // light<->dark switch. Harmless if uiMode triggers a recreate instead:
        // onCreate re-applies the background anyway.
        super.onConfigurationChanged(newConfig);
        applyThemedBackground(newConfig);
    }

    private void applyThemedBackground(Configuration config) {
        boolean dark = (config.uiMode & Configuration.UI_MODE_NIGHT_MASK)
                == Configuration.UI_MODE_NIGHT_YES;
        int background = dark ? BACKGROUND_DARK : BACKGROUND_LIGHT;
        getWindow().getDecorView().setBackgroundColor(background);
        if (getBridge() != null && getBridge().getWebView() != null) {
            getBridge().getWebView().setBackgroundColor(background);
        }
    }
}
