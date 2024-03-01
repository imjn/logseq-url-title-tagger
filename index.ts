import '@logseq/libs';

const DEFAULT_REGEX = {
    wrappedInCommand: /(\{\{(video)\s*(https?:\/\/(?:www\.|(?!www))[a-zA-Z0-9][a-zA-Z0-9-]+[a-zA-Z0-9]\.[^\s]{2,}|www\.[a-zA-Z0-9][a-zA-Z0-9-]+[a-zA-Z0-9]\.[^\s]{2,}|https?:\/\/(?:www\.|(?!www))[a-zA-Z0-9]+\.[^\s]{2,}|www\.[a-zA-Z0-9]+\.[^\s]{2,})\s*\}\})/gi,
    htmlTitleTag: /<title(\s[^>]+)*>([^<]*)<\/title>/,
    url: /\bhttps?:\/\/(?:www\.)?[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}(?::\d{1,5})?(?:\/[^\s]*)?\b/gi,
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

function decodeHTML(input) {
    if (!input) {
        return '';
    }

    const doc = new DOMParser().parseFromString(input, 'text/html');
    return doc.documentElement.textContent;
}

async function getTitle(url) {
    try {
        const response = await fetch(url);
        // Skip Forbidden, Unauthorized
        if (response.status === 403 || response.status === 401) {
            return '';
        }
        const responseText = await response.text();
        const matches = DEFAULT_REGEX.htmlTitleTag.exec(responseText);
        if (matches !== null && matches.length > 1 && matches[2] !== null) {
            return decodeHTML(matches[2].trim());
        }
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
    }`);

    const doc = parent.document;
    const appContainer = doc.getElementById('app-container');

    // External links favicons
    const setFavicon = (extLinkEl: HTMLAnchorElement) => {
        const oldFav = extLinkEl.querySelector('.external-link-img');
        if (oldFav) {
            oldFav.remove();
        }
        const { hostname } = new URL(extLinkEl.href);
        const faviconValue = `https://www.google.com/s2/favicons?domain=${hostname}&sz=32`;
        const fav = doc.createElement('img');
        fav.src = faviconValue;
        fav.width = 16;
        fav.height = 16;
        fav.classList.add('external-link-img');
        extLinkEl.insertAdjacentElement('afterbegin', fav);
    };

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
                                await parseBlockForLink(blockId);

                                addedNode.querySelectorAll('.external-link').forEach((extLink) => {
                                    const extLinkElement = extLink as HTMLAnchorElement;
                                    setFavicon(extLinkElement);
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
