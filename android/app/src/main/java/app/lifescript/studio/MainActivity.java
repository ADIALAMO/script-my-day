package app.lifescript.studio;

import android.graphics.Color;
import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        // Defense-in-depth for the splash-to-content handoff: the WebView's own
        // default surface is white until the first real paint. If any gap remains
        // between the splash hiding and the remote page painting, this is what
        // shows instead of a white flash.
        getBridge().getWebView().setBackgroundColor(Color.parseColor("#030712"));
    }
}
