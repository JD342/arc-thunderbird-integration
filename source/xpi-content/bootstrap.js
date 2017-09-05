/*
 ~  Copyright (c) 2017 Nicola Fiori (JD342)
 ~
 ~  This file is part of the Arc Integration for Thunderbird, licensed under
 ~  the terms of the GNU General Public License 3.0.
 ~
 */

/* eslint-env browser */

/* -- globals --------------------------------------------------------------- */

const XHTMLNS = 'http://www.w3.org/1999/xhtml';
const AIT_PREFS_DOMAIN = 'extensions.net.jd342.ait';

const PREFERENECES_DIALOG_LOCATION =
    'chrome://messenger/content/preferences/preferences.xul';

const PARAMS_LOCATION = 'chrome://ait/content/params.json';

/* global Components */
const { classes: Cc, utils: Cu } = Components;

Cu.importGlobalProperties(['fetch']);

/* global XPCOMUtils */
Cu.import('resource://gre/modules/XPCOMUtils.jsm');

const {
    nsIWindowMediator,
    nsIInterfaceRequestor,
    nsIDOMWindow,
    nsIPrefService,
    nsIPrefBranch,
    nsISupportsWeakReference,
    nsIWebProgress,
    nsIWebProgressListener
} = Components.interfaces;

const wm =
    Cc['@mozilla.org/appshell/window-mediator;1']
        .getService(nsIWindowMediator);

const prefs =
    Cc['@mozilla.org/preferences-service;1']
        .getService(nsIPrefService)
        .QueryInterface(nsIPrefBranch);

const AIT = {};

/* -- root logic ------------------------------------------------------------ */

function initialize(win) {
    const url = win.location.href.split('#')[0];
    if (AIT.Parameters.isWindowToRestyle(url)) AIT.Styling.load(win);
    if (url === PREFERENECES_DIALOG_LOCATION) AIT.PreferencesPanel.load(win);
}

function teardown(win) {
    const url = win.location.href.split('#')[0];
    if (AIT.Parameters.isWindowToRestyle(url)) AIT.Styling.unload(win);
    if (url === PREFERENECES_DIALOG_LOCATION) AIT.PreferencesPanel.unload(win);
}

function startup() { // eslint-disable-line no-unused-vars
    AIT.fullyInitialized = false;
    AIT.Parameters.main();
    AIT.Parameters.retrievalConclusion.then(() => {
        AIT.Preferences.main();
        AIT.Styling.main();
        AIT.PreferencesPanel.main();
        AIT.WindowManager.main();
        AIT.fullyInitialized = true;
    });
}

function shutdown() { // eslint-disable-line no-unused-vars
    if (AIT.fullyInitialized) {
        AIT.WindowManager.end();
        AIT.PreferencesPanel.end();
        AIT.Styling.end();
        AIT.Preferences.end();
    }
    AIT.Parameters.end();
}

function install(data, reason) { // eslint-disable-line no-unused-vars
}

function uninstall(data, reason) { // eslint-disable-line no-unused-vars
}

/* -- parameters retrieval module ------------------------------------------- */

// The integration parameters retrieval module has the job to retrieve and
// parse the `params.json` file when its `main` function is invoked.

AIT.Parameters = (() => {

    const _conclPr = Symbol('ParamsRetrieval Conclusion Promise');
    const _aborted = Symbol('ParamsRetrieval Abortion Handle');
    const _abort = Symbol('ParamsRetrieval Abort Function');
    const _retrievedObj = Symbol('ParamsRetrieval Retrieved Object');

    const ParamsRetrieval = {

        get conclusion() { return this[_conclPr]; },

        get retrievedObject() { return this[_retrievedObj]; },

        init() {
            this.init = null;
            this[_aborted] = false;
            this[_retrievedObj] = null;
            this[_conclPr] = new Promise((res) => {
                fetch(PARAMS_LOCATION).then(r => r.json()).then((obj) => {
                    if (this[_aborted]) return;
                    this[_retrievedObj] = obj;
                    res();
                });
                this[_abort] = () => { this[_aborted] = true; };
            });
            return this;
        },

        abort() { this[_abort](); }

    };

    return {
        main,
        end,
        isWindowToRestyle,
        get retrievalConclusion() { return retrieval.conclusion; },
        get preferences() { return preferences; }
    };

    var retrieval;
    var windowsToRestyleSet;
    var preferences;

    function main() {
        retrieval = Object.create(ParamsRetrieval).init();
        retrieval.conclusion.then(() => {
            const { retrievedObject } = retrieval;
            windowsToRestyleSet = new Set(retrievedObject.windowsToRestyle);
            preferences = retrievedObject.preferences;
        });
    }

    function end() {
        if (!retrieval.concluded) retrieval.abort();
        retrieval = null;
        windowsToRestyleSet = null;
        preferences = null;
    }

    function isWindowToRestyle(winURL) {
        return windowsToRestyleSet.has(winURL);
    }

})();

/* -- window manager module ------------------------------------------------- */

// The integration window manager has the job to detect existence of DOM windows
// and invoke the `initialize` function for each detected DOM window, and to
// invoke the `teardown` function afterwards when either the window closes or
// the integration window manager is shut down by calling its `end` function.

AIT.WindowManager = (() => {

    return { main, end };

    var windowListener;
    var documentListener;
    var initializedWindows;
    var toreDownWindows;
    var unloadListeners;

    function main() {
        initializedWindows = new WeakSet();
        toreDownWindows = new WeakSet();
        unloadListeners = new WeakMap();
        documentListener = {
            QueryInterface:
                XPCOMUtils.generateQI([
                    nsIWebProgressListener,
                    nsISupportsWeakReference
                ]),
            onStateChange(progress, request, flags) {
                if (flags & nsIWebProgressListener.STATE_IS_DOCUMENT) {
                    const win = progress.DOMWindow;
                    if (win.location.href !== 'about:blank')
                        handleWindowInitialization(win);
                }
            },
            onLocationChange() {},
            onProgressChange() {},
            onStatusChange() {},
            onSecurityChange() {}
        };
        windowListener = {
            onOpenWindow(obj) {
                handleTopWindowInitialization(
                    obj.QueryInterface(nsIInterfaceRequestor)
                        .getInterface(nsIDOMWindow)
                );
            },
            onCloseWindow(obj) {
                handleTopWindowTeardown(
                    obj.QueryInterface(nsIInterfaceRequestor)
                        .getInterface(nsIDOMWindow)
                );
            },
            onWindowTitleChange() {}
        };
        for (let win of getTopWindows()) handleTopWindowInitialization(win);
        wm.addListener(windowListener);
    }

    function end() {
        wm.removeListener(windowListener);
        for (let win of getTopWindows()) handleTopWindowTeardown(win);
        documentListener = null;
        windowListener = null;
        initializedWindows = null;
        toreDownWindows = null;
    }

    function handleTopWindowInitialization(win) {
        win.document.docShell.QueryInterface(nsIInterfaceRequestor)
            .getInterface(nsIWebProgress)
            .addProgressListener(documentListener, nsIWebProgress.NOTIFY_ALL);
        for (let w of [win, ...getSubWindows(win)])
            if (w.location.href !== 'about:blank')
                handleWindowInitialization(w);
    }

    function handleTopWindowTeardown(win) {
        win.document.docShell.QueryInterface(nsIInterfaceRequestor)
            .getInterface(nsIWebProgress)
            .removeProgressListener(documentListener);
        for (let w of [win, ...getSubWindows(win)])
            if (w.location.href !== 'about:blank')
                handleWindowTearDown(w);
    }

    function handleWindowInitialization(win) {
        if (!initializedWindows.has(win)) {
            initializedWindows.add(win);
            toreDownWindows.delete(win);
            const unloadListener = () => { handleWindowTearDown(win); };
            unloadListeners.set(win, unloadListener);
            win.addEventListener('unload', unloadListener);
            initialize(win);
        }
    }

    function handleWindowTearDown(win) {
        if (initializedWindows.has(win) && !toreDownWindows.has(win)) {
            toreDownWindows.add(win);
            initializedWindows.delete(win);
            win.removeEventListener('unload', unloadListeners.get(win));
            unloadListeners.delete(win);
            teardown(win);
        }
    }

    function* getTopWindows() {
        const windows = wm.getEnumerator(null);
        while (windows.hasMoreElements()) yield windows.getNext();
    }

    function* getSubWindows(win) {
        for (let w of Array.from(win)) {
            yield w;
            yield* getSubWindows(w);
        }
    }

})();

/* -- style integration module ---------------------------------------------- */

// The style integration module has the job to inject styling in a specified
// window when its `load` funtion is invoked, dynamically update styling when
// some preference is modified, and remove everything afterwards on its `unload`
// function invocation.

AIT.Styling = (() => {

    const PreferenceAttributeDescriptor = {

        init(preference) {
            const name =
                'ait-' +
                preference.name.replace(/[A-Z]/g, m => `-${m.toLowerCase()}`) +
                '-preference';
            Object.assign(this, { name, preference });
            return this;
        }

    };

    return { main, end, load, unload };

    var unloadListenersCollections;
    var preferenceAttributeDescriptors;

    function main() {
        unloadListenersCollections = new WeakMap();
        preferenceAttributeDescriptors =
            Array.from(AIT.Preferences.getSpecificPreferences())
                .map(p => Object.create(PreferenceAttributeDescriptor).init(p));
    }

    function end() {
        unloadListenersCollections = null;
    }

    function load(win) {
        var root;
        const doc = win.document;
        const unloadListeners = new Set();
        unloadListenersCollections.set(win, unloadListeners);
        if (doc.readyState === 'interactive' || doc.readyState === 'complete')
            onceDocumentIsInteractive();
        else {
            const rsChangeListener = () => {
                const state = doc.readyState;
                if (state === 'interactive' || state === 'complete') {
                    unloadListeners.delete(unloadListener);
                    doc.removeEventListener('readystatechange', rsChangeListener);
                    onceDocumentIsInteractive();
                }
            };
            const unloadListener = () => {
                doc.removeEventListener('readystatechange', rsChangeListener);
            };
            unloadListeners.add(unloadListener);
            doc.addEventListener('readystatechange', rsChangeListener);
        }
        function onceDocumentIsInteractive() {
            root = doc.firstElementChild;
            handlePreferenceAttributes();
            handleStyling();
        }
        function handlePreferenceAttributes() {
            preferenceAttributeDescriptors.forEach(({ name, preference }) => {
                preference.watch(onUpdate);
                unloadListeners.add(onUnload);
                onUpdate();
                function onUnload() {
                    preference.stopWatching(onUpdate);
                }
                function onUpdate() {
                    root.setAttribute(name, preference.value);
                }
            });
        }
        function handleStyling() {
            const style = doc.createElementNS(XHTMLNS, 'style');
            style.textContent =
                '@import url("chrome://ait/content/styling.css");';
            root.appendChild(style);
            unloadListeners.add(() => { style.remove(); });
        }
    }

    function unload(win) {
        for (let fn of unloadListenersCollections.get(win)) fn();
    }

})();

/* -- preferences handling module ------------------------------------------- */

// The integration preferences module has the job to interface the whole add-on
// with the XPCOM preferences service. It exposes the preferences in a
// prototypical OOP way and also implements the concept of parent/child
// preferences, where parent preferences generalize more specific child
// preferences, making customization more simple for the end-user.

AIT.Preferences = (() => {

    const _init = Symbol('Preference Initializer');
    const _name = Symbol('Preference Name');
    const _parent = Symbol('Preference Parent');
    const _configurable = Symbol('Preference Configurability Handle');
    const _domain = Symbol('Preference Domain');
    const _val = Symbol('Preference Value');
    const _opts = Symbol('Preference Options');
    const _watchers = Symbol('Preference Watchers');
    const _handleChange = Symbol('Preference Change Handler');

    const Preference = {

        [_parent]: null,
        [_configurable]: true,

        get name() { return this[_name]; },

        get parent() { return this[_parent]; },

        get configurable() { return this[_configurable]; },

        get value() { return this[_val]; },

        set value(value) {
            if (this[_val] === value) return value;
            if (!this[_configurable]) {
                const msg =
                    'value setter invoked when preference was not configurable';
                console.assert(false, msg);
                return;
            }
            if (!this[_opts].has(value)) {
                const msg = 'passed unexpected option to the value setter';
                console.assert(false, msg);
                return;
            }
            this[_val] = value;
            prefs.setCharPref(this[_domain], value);
            this[_handleChange]();
            return value;
        },

        [_init](name) {
            const descriptor = AIT.Parameters.preferences[name];
            const { options } = descriptor;
            const watchers = new Set();
            const optionsSet = new Set(options);
            this[_name] = name;
            this[_opts] = optionsSet;
            this[_watchers] = watchers;
            // Initialize domain
            const camelCasedName =
                name.replace(/-[a-z]/g, m => m[1].toUpperCase());
            const domain = AIT_PREFS_DOMAIN + '.' + camelCasedName;
            this[_domain] = domain;
            // Initialize value
            if (!(_val in this)) {
                let valueRetrieved = false;
                if (prefs.getPrefType(domain) === nsIPrefBranch.PREF_STRING) {
                    const value = prefs.getCharPref(domain);
                    if (optionsSet.has(value)) {
                        this[_val] = value;
                        valueRetrieved = true;
                    }
                }
                if (!valueRetrieved) this[_val] = options[0];
            }
            // Initialize presets
            if ('presets' in descriptor) {
                optionsSet.add('custom');
                let wasCustom = this[_val] === 'custom';
                let isCustom = wasCustom;
                let customizabilityChanged;
                watchers.add(() => {
                    isCustom = this[_val] === 'custom';
                    customizabilityChanged = wasCustom !== isCustom;
                });
                Object.entries(descriptor.presets).forEach((entry) => {
                    const [presetPrefName, presetValues] = entry;
                    const presetPref = prefsMap.get(presetPrefName);
                    const presetMap =
                        new Map(options.map((v, i) => [v, presetValues[i]]));
                    presetPref[_parent] = this;
                    presetPref[_configurable] = isCustom;
                    if (!isCustom) presetPref[_val] = presetMap.get(this[_val]);
                    watchers.add(() => {
                        const oldVal = presetPref[_val];
                        const newVal =
                            isCustom ? oldVal : presetMap.get(this[_val]);
                        presetPref[_configurable] = isCustom;
                        presetPref[_val] = newVal;
                        if (customizabilityChanged || oldVal !== newVal)
                            presetPref[_handleChange]();
                    });
                });
                watchers.add(() => { wasCustom = isCustom; });
            }
            return this;
        },

        /**
         * @param {function():void} watcher
         */
        watch(watcher) { this[_watchers].add(watcher); },

        /**
         * @param {function():void} watcher
         */
        stopWatching(watcher) { this[_watchers].delete(watcher); },

        options: function* () { yield* this[_opts]; },

        [_handleChange]() { for (let fn of this[_watchers]) fn(); }

    };

    return {
        main,
        end,
        getSpecificPreferences,
        getPreferences
    };

    var genericPrefsMap;
    var specificPrefsMap;
    var prefsMap;

    function main() {
        genericPrefsMap = new Map();
        specificPrefsMap = new Map();
        prefsMap = new Map();
        for (let entry of Object.entries(AIT.Parameters.preferences)) {
            const [name, descr] = entry;
            const map = 'presets' in descr ? genericPrefsMap : specificPrefsMap;
            const pref = Object.create(Preference);
            map.set(name, pref);
            prefsMap.set(name, pref);
        }
        for (let [name, pref] of prefsMap) pref[_init](name);
    }

    function end() {
        genericPrefsMap = null;
        specificPrefsMap = null;
        prefsMap = null;
    }

    function* getSpecificPreferences() {
        yield* specificPrefsMap.values();
    }

    function* getPreferences() {
        yield* prefsMap.values();
    }

})();

/* -- preferences panel handling module ------------------------------------- */

// The integration preferences panel module has the job to populate the
// preferences user interface with all the preferences of the integration.

AIT.PreferencesPanel = (() => {

    return { main, end, load, unload };

    var unloadListenersCollections;

    function main() {
        unloadListenersCollections = new WeakMap();
    }

    function end() {
        unloadListenersCollections = null;
    }

    function load(win) {
        var unloaded = false;
        const doc = win.document;
        const unloadListeners = [() => { unloaded = true; }];
        unloadListenersCollections.set(win, unloadListeners);
        new Promise((onceDocumentLoads) => {
            if (doc.readyState === 'complete') onceDocumentLoads();
            else doc.addEventListener('readystatechange', function listenr() {
                if (unloaded || doc.readyState === 'complete')
                    doc.removeEventListener('readystatechange', listenr);
                if (!unloaded && doc.readyState === 'complete')
                    onceDocumentLoads();
            });
        }).then(() => new Promise((onceDisplayPaneExists) => {
            // In each iteration the delay will be incremented by 1ms. This
            // is done to minimize the performance impact of the sniffing
            // routine.
            var delay = 0;
            (function sniffer() {
                if (unloaded) return;
                const displayPane =
                    doc.firstElementChild.preferencePanes &&
                    doc.firstElementChild.preferencePanes.paneDisplay;
                if (displayPane) onceDisplayPaneExists(displayPane);
                else win.setTimeout(sniffer, delay++);
            })();
        })).then((displayPane) => new Promise((onceDisplayPaneLoads) => {
            if (unloaded) return;
            if (win.location.hash === '#aitTab')
                doc.firstElementChild.showPane(displayPane);
            if (displayPane.loaded) onceDisplayPaneLoads(displayPane);
            else displayPane.addEventListener('paneload', function listener() {
                displayPane.removeEventListener('paneload', listener);
                if (unloaded) return;
                onceDisplayPaneLoads(displayPane);
            });
        })).then(() => new Promise((onceNecessaryElemsExist) => {
            // In each iteration the delay will be incremented by 1ms. This
            // is done to minimize the performance impact of the sniffing
            // routine.
            var delay = 0;
            (function sniffer() {
                if (unloaded) return;
                // Try to retrieve the necessary elements for initializing the
                // preferences panel. If they don't yet exist, postpone
                // initialization.
                const tabsElem = doc.getElementById('displayPrefsTabs');
                if (tabsElem === null) {
                    // #displayPrefsTabs does not exist, try again later.
                    win.setTimeout(sniffer, delay++);
                    return;
                }
                const panelsElem = doc.getElementById('displayPrefsPanels');
                if (panelsElem === null) {
                    // #displayPrefsPanels does not exist, try again later.
                    win.setTimeout(sniffer, delay++);
                    return;
                }
                // #displayPrefsTabs and #displayPrefsPanels both exist
                onceNecessaryElemsExist([tabsElem, panelsElem]);
            })();
        })).then(([tabsElem, panelsElem]) => {
            if (unloaded) return;
            handleTabInitialization(tabsElem);
            handleTabPanelInitialization(panelsElem);
        });
        function handleTabInitialization(tabsElem) {
            const tab = doc.createElement('tab');
            tab.setAttribute('id', 'aitTab');
            tab.setAttribute('label', 'Arc Integration');
            tabsElem.appendChild(tab);
            win.requestAnimationFrame(() => {
                if (win.location.hash === '#aitTab') tab.click();
            });
            unloadListeners.push(() => { tab.remove(); });
        }
        function handleTabPanelInitialization(panelsElem) {
            const tabpanel = doc.createElement('tabpanel');
            const form = doc.createElementNS(XHTMLNS, 'form');
            const divs = new WeakMap();
            unloadListeners.push(() => { tabpanel.remove(); });
            tabpanel.setAttribute('id', 'aitPrefsPanel');
            tabpanel.setAttribute('orient', 'vertical');
            Object.assign(form.style, {
                height: '300px',
                display: 'block',
                overflowY: 'scroll',
                border: `${1 / win.devicePixelRatio}px solid rgba(20,20,20,0.1)`
            });
            const preferences = Array.from(AIT.Preferences.getPreferences());
            for (let pref of preferences) {
                const div = doc.createElementNS(XHTMLNS, 'div');
                divs.set(pref, div);
            }
            preferences.forEach((pref) => {
                const { type, name } = pref;
                const div = divs.get(pref);
                const span = doc.createElementNS(XHTMLNS, 'span');
                const inputName = `${type}_${name}`;
                span.textContent = `${toCapitalizedWords(name)}:`;
                div.appendChild(span);
                Object.assign(span.style, {
                    display: 'block',
                    overflow: 'hidden',
                    transition: 'opacity 300ms ease, height 300ms ease',
                    lineHeight: '1.3em'
                });
                Object.assign(div.style, {
                    marginLeft: '1ch',
                    transition: 'opacity 300ms ease'
                });
                Array.from(pref.options()).forEach((value) => {
                    const input = doc.createElementNS(XHTMLNS, 'input');
                    const label = doc.createElementNS(XHTMLNS, 'label');
                    const txt = doc.createTextNode(toCapitalizedWords(value));
                    input.type = 'radio';
                    input.name = inputName;
                    input.addEventListener('change', () => {
                        pref.value = value;
                    });
                    label.appendChild(input);
                    label.appendChild(txt);
                    span.appendChild(label);
                    pref.watch(onUpdate);
                    onUpdate();
                    unloadListeners.push(() => {
                        pref.stopWatching(onUpdate);
                    });
                    if (pref.parent !== null) {
                        const onChildPrefUpdate = () => {
                            if (pref.configurable)
                                input.removeAttribute('disabled');
                            else input.setAttribute('disabled', '');
                        };
                        pref.watch(onChildPrefUpdate);
                        onChildPrefUpdate();
                        unloadListeners.push(() => {
                            pref.stopWatching(onChildPrefUpdate);
                        });
                    }
                    function onUpdate() {
                        input.checked = value === pref.value;
                    }
                });
                if (pref.parent !== null) {
                    const onUpdate = () => {
                        div.style.opacity =
                            pref.configurable ? null : '0.3';
                    };
                    pref.watch(onUpdate);
                    unloadListeners.push(() => {
                        pref.stopWatching(onUpdate);
                    });
                    onUpdate();
                    const parent = pref.parent;
                    if (parent.parent !== null) {
                        const onUpdate = () => {
                            span.style.height =
                                parent.configurable ? '1.3em' : '0';
                            span.style.opacity =
                                parent.configurable ? null : '0';
                        };
                        parent.watch(onUpdate);
                        unloadListeners.push(() => {
                            parent.stopWatching(onUpdate);
                        });
                        onUpdate();
                    }
                    divs.get(parent).appendChild(div);
                }
                else form.appendChild(div);
            });
            tabpanel.appendChild(form);
            panelsElem.appendChild(tabpanel);
        }
    }

    function unload(win) {
        for (let fn of unloadListenersCollections.get(win)) fn();
    }

    /**
     * @param   {string} dashCasedWords
     * @returns {string}
     *
     * toCapitalizedWords('foo-bar-baz') -> 'Foo Bar Baz'
     */
    function toCapitalizedWords(dashCasedWords) {
        return dashCasedWords[0].toUpperCase() +
               dashCasedWords.substr(1)
                   .replace(/-[a-z]/g, m => ` ${m[1].toUpperCase()}`);
    }

})();
