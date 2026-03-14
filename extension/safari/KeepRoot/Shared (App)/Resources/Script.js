function show(platform, enabled, useSettingsInsteadOfPreferences) {
    const actionButton = document.querySelector("button.open-preferences");
    document.body.dataset.platform = platform;
    document.body.dataset.state = "unknown";

    if (platform !== "mac") {
        return;
    }

    if (useSettingsInsteadOfPreferences) {
        document.getElementsByClassName("state-on")[0].innerText =
            "The extension is on. Open Safari and use the toolbar button to save pages into KeepRoot.";
        document.getElementsByClassName("state-off")[0].innerText =
            "The extension is off. Turn it on in the Extensions section of Safari Settings before saving pages.";
        document.getElementsByClassName("state-unknown")[0].innerText =
            "The extension is installed. Open the Extensions section of Safari Settings to turn it on.";
        actionButton.innerText = "Quit and Open Safari Settings";
    } else {
        document.getElementsByClassName("state-on")[0].innerText =
            "The extension is on. Open Safari and use the toolbar button to save pages into KeepRoot.";
        document.getElementsByClassName("state-off")[0].innerText =
            "The extension is off. Turn it on in Safari Extensions Preferences before saving pages.";
        document.getElementsByClassName("state-unknown")[0].innerText =
            "The extension is installed. Open Safari Extensions Preferences to turn it on.";
        actionButton.innerText = "Quit and Open Safari Extensions Preferences";
    }

    if (typeof enabled === "boolean") {
        document.body.dataset.state = enabled ? "on" : "off";
    }
}

function openPreferences() {
    webkit.messageHandlers.controller.postMessage("open-preferences");
}

document.querySelector("button.open-preferences")?.addEventListener("click", openPreferences);
