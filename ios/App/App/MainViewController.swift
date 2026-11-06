import Capacitor
import UIKit

/// Registers the app's own native plugin, which lives in this target rather than an npm package.
class MainViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(MorseHardwarePlugin())
    }
}
