import '@logseq/libs';
import hosts from './hosts.json'
import { SettingSchemaDesc } from '@logseq/libs/dist/LSPlugin'


const settings: SettingSchemaDesc[] = [{
    key: 'uttHosts',
    type: 'object',
    default: hosts,
    title: 'Hosts',
    description: 'Special CSS Selectors to find title in specific hosts'
}]

logseq.useSettingsSchema(settings)

const DEFAULT_REGEX = {
    wrappedInCommand: /(\{\{(video)\s*(https?:\/\/(?:www\.|(?!www))[a-zA-Z0-9][a-zA-Z0-9-]+[a-zA-Z0-9]\.[^\s]{2,}|www\.[a-zA-Z0-9][a-zA-Z0-9-]+[a-zA-Z0-9]\.[^\s]{2,}|https?:\/\/(?:www\.|(?!www))[a-zA-Z0-9]+\.[^\s]{2,}|www\.[a-zA-Z0-9]+\.[^\s]{2,})\s*\}\})/gi,
    url: /\bhttps?:\/\/(?:www\.)?[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}(?::\d{1,5})?(?:\/[^\s]*)?(?=\s|$)/gi,
    imageExtension: /\.(gif|jpe?g|tiff?|png|webp|bmp|tga|psd|ai)$/i,
};

const FORMAT_SETTINGS = {
    markdown: {
        formatBeginning: '](',
        applyFormat: (title, url) => `[${title}](${url})`,
    },
    org: {
        formatBeginning: '][',
        applyFormat: (title, url) => `[[${url}][${title}]]`,
    },
};

async function getTitle(url) {
    try {
        const response = await fetch(url);
        // Skip Forbidden, Unauthorized
        if (response.status === 403 || response.status === 401) {
            return '';
        }
        if (response == null) return

        const contentType = response.headers.get('Content-Type')
        const charset = contentType !== null && contentType.includes('charset=') ? contentType.split('charset=')[1] : 'UTF-8';

        const buffer = await response.arrayBuffer();
        const html = await new TextDecoder(charset).decode(new Uint8Array(buffer))

        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');

        // try to find a title in a special way on json
        const host = new URL(url).host.replace('www.', '')
        if (host in logseq.settings?.uttHosts) {
            const customSelector = doc.querySelector(hosts[host])
            if (customSelector !== null) return customSelector.innerText.trim()
        }

        // if h1 not found return web title (Reddit)
        const title = doc.querySelector('title')
        if (title !== null) return title.innerText
        


    } catch (e) {
        console.error('Error fetching title:', e);
    }

    return '';
}

async function convertUrlToMarkdownLink(url, text, urlStartIndex, offset, applyFormat) {
    const title = await getTitle(url);
    if (title === '') {
        return { text, offset };
    }

    const startSection = text.slice(0, urlStartIndex);
    const wrappedUrl = applyFormat(title, url);
    const endSection = text.slice(urlStartIndex + url.length);

    return {
        text: `${startSection}${wrappedUrl}${endSection}`,
        offset: urlStartIndex + url.length,
    };
}

function isImage(url) {
    const imageRegex = new RegExp(DEFAULT_REGEX.imageExtension);
    return imageRegex.test(url);
}

function isAlreadyFormatted(text, url, urlIndex, formatBeginning) {
    return text.slice(urlIndex - 2, urlIndex) === formatBeginning;
}

function isWrappedInCommand(text, url) {
    const wrappedLinks = text.match(DEFAULT_REGEX.wrappedInCommand);
    if (!wrappedLinks) {
        return false;
    }

    return wrappedLinks.some(command => command.includes(url));
}

async function getFormatSettings() {
    const { preferredFormat } = await logseq.App.getUserConfigs();
    if (!preferredFormat) {
        return null;
    }

    return FORMAT_SETTINGS[preferredFormat];
}

async function parseBlockForLink(uuid: string | null = null) {
    if (!uuid || uuid === '' || uuid === null) {
        return;
    }

    const rawBlock = await logseq.Editor.getBlock(uuid);
    if (!rawBlock) {
        console.error('⛔️ Block not found');
        return;
    }

    let match;
    const urls: string[] = [];

    let text = rawBlock.content;
    while ((match = DEFAULT_REGEX.url.exec(text)) !== null) {
        urls.push(match[0]);
    }
    if (!urls) {
        console.error('⛔️ No urls found');
        return;
    }

    const formatSettings = await getFormatSettings();
    if (!formatSettings) {
        console.error('⛔️ No format settings found');
        return;
    }

    let offset = 0;
    for (const url of urls) {
        const urlIndex = text.indexOf(url, offset);

        if (isAlreadyFormatted(text, url, urlIndex, formatSettings.formatBeginning) || isImage(url) || isWrappedInCommand(text, url)) {
            continue;
        }
        const updatedTitle = await convertUrlToMarkdownLink(url, text, urlIndex, offset, formatSettings.applyFormat);
        text = updatedTitle.text;
        offset = updatedTitle.offset;
    }

    await logseq.Editor.updateBlock(uuid, text);
}

const main = async () => {
    logseq.provideStyle(`
    .external-link {
        padding: 2px 4px;
        border-radius: 3px;
        border: 0;
        text-decoration: underline;
        text-decoration-style: dashed;
        text-decoration-thickness: 1px;
        text-underline-offset: 2px;
    }
    .external-link-img {
        display: var(--favicons, inline-block);
        width: 16px;
        height: 16px;
        margin: -3px 7px 0 0;
    }
    .loading-indicator {
        display: var(--indicator, inline-block);
        width: 16px;
        height: 16px;
        border-radius: 50%;
        border: 2px solid #f3f3f3;
        border-top: 2px solid var(--indicator-color, #3498db);
        animation: spin 2s linear infinite;
        margin: -3px 7px 0 0;
    }
    `);

    const doc = parent.document;
    const appContainer = doc.getElementById('app-container');

    // External links favicons
    const setFavicon = (extLinkEl: HTMLAnchorElement) => {
        const oldFav = extLinkEl.querySelector('.external-link-img');
        if (oldFav) {
            console.log('Removing old favicon:', oldFav);
            oldFav.remove();
        }
        const { hostname } = new URL(extLinkEl.href);
        const faviconValue = `https://www.google.com/s2/favicons?domain=${hostname}&sz=32`;
        const fav = document.createElement('img');
        fav.src = faviconValue;
        fav.width = 16;
        fav.height = 16;
        fav.classList.add('external-link-img');
        extLinkEl.insertAdjacentElement('afterbegin', fav);
    };

    const setLoadingIndicator = (extLinkEl: HTMLAnchorElement, isLoading: boolean) => {
        const oldLoadingIndicator = extLinkEl.querySelector('.loading-indicator');
        if (oldLoadingIndicator) {
            oldLoadingIndicator.remove();
        }
        if (isLoading) {
            const loadingIndicator = doc.createElement('div');
            loadingIndicator.classList.add('loading-indicator');
            extLinkEl.insertAdjacentElement('afterbegin', loadingIndicator);
        }
    }

    const extLinksObserverConfig = { childList: true, subtree: true };
    const extLinksObserver = new MutationObserver((mutationsList, _) => {
        for (const element of mutationsList) {
            const addedNode = element.addedNodes[0] as Element;
            if (addedNode?.childNodes.length) {
                if (addedNode.querySelector('.external-link')) {
                    extLinksObserver.disconnect();

                    (async (addedNode) => {
                        const blockId = addedNode.querySelectorAll('.block-content')[0].getAttribute('blockid')
                        if (blockId) {
                            try {
                                addedNode.querySelectorAll('.external-link').forEach((extLink) => {
                                    const extLinkElement = extLink as HTMLAnchorElement;
                                    setLoadingIndicator(extLinkElement, true);
                                });

                                await parseBlockForLink(blockId);

                                addedNode.querySelectorAll('.external-link').forEach((extLink) => {
                                    const extLinkElement = extLink as HTMLAnchorElement;
                                    setFavicon(extLinkElement);
                                    setLoadingIndicator(extLinkElement, false);
                                });
                            } catch (error) {
                                console.error('Error in async task:', error)
                            }
                        }

                    })(addedNode);

                    if (appContainer) {
                        extLinksObserver.observe(appContainer, extLinksObserverConfig)
                    }
                }
            }
        }
    });

    setTimeout(() => {
        doc.querySelectorAll('.external-link')?.forEach(extLink => setFavicon(extLink as HTMLAnchorElement));
        if (appContainer) {
            extLinksObserver.observe(appContainer, extLinksObserverConfig);
        }
    }, 500);

    logseq.Editor.registerBlockContextMenuItem('Format url titles', async ({ uuid }) => {
        await parseBlockForLink(uuid);
        const extLinkList: NodeListOf<HTMLAnchorElement> = doc.querySelectorAll('.external-link');
        extLinkList.forEach(extLink => setFavicon(extLink));
    });

    doc.querySelectorAll('.external-link')?.forEach(extLink => setFavicon(extLink as HTMLAnchorElement));
};

logseq.ready(main).catch(console.error);
