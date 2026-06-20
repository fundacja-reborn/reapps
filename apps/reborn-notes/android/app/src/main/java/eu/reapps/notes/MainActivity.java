package eu.reapps.notes;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Register the app-local FolderFs plugin (native folder sync, disk -> app)
        // BEFORE super.onCreate so the bridge wires it up during initialization.
        // This is the Android counterpart of iOS
        // MainViewController.capacitorDidLoad(); add future app-local plugins here
        // the same way.
        registerPlugin(FolderFsPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
