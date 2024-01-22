/* eslint-disable @lwc/lwc/no-async-await */
import type {NetworkCacheEntry, NetworkCacheMap} from '@libs/E2E/types';

const LOG_TAG = `[E2E][NetworkInterceptor]`;
// Requests with these headers will be ignored:
const IGNORE_REQUEST_HEADERS = ['X-E2E-Server-Request'];

let globalResolveIsNetworkInterceptorInstalled: () => void;
let globalRejectIsNetworkInterceptorInstalled: (error: Error) => void;
const globalIsNetworkInterceptorInstalledPromise = new Promise<void>((resolve, reject) => {
    globalResolveIsNetworkInterceptorInstalled = resolve;
    globalRejectIsNetworkInterceptorInstalled = reject;
});
let networkCache: NetworkCacheMap | null = null;

/**
 * The headers of a fetch request can be passed as an array of tuples or as an object.
 * This function converts the headers to an object.
 */
function getFetchRequestHeadersAsObject(fetchRequest: RequestInit): Record<string, string> {
    const headers: Record<string, string> = {};
    if (Array.isArray(fetchRequest.headers)) {
        fetchRequest.headers.forEach(([key, value]) => {
            headers[key] = value;
        });
    } else if (typeof fetchRequest.headers === 'object') {
        Object.entries(fetchRequest.headers).forEach(([key, value]) => {
            headers[key] = value;
        });
    }
    return headers;
}

/**
 * This function extracts the RequestInit from the arguments of fetch.
 * It is needed because the arguments can be passed in different ways.
 */
function fetchArgsGetRequestInit(args: Parameters<typeof fetch>): RequestInit {
    const [firstArg, secondArg] = args;
    if (typeof firstArg === 'string' || (typeof firstArg === 'object' && firstArg instanceof URL)) {
        if (secondArg == null) {
            return {};
        }
        return secondArg;
    }
    return firstArg;
}

function fetchArgsGetUrl(args: Parameters<typeof fetch>): string {
    const [firstArg] = args;
    if (typeof firstArg === 'string') {
        return firstArg;
    }
    if (typeof firstArg === 'object' && firstArg instanceof URL) {
        return firstArg.href;
    }
    if (typeof firstArg === 'object' && firstArg instanceof Request) {
        return firstArg.url;
    }
    throw new Error('Could not get url from fetch args');
}

function networkCacheEntryToResponse({headers, status, statusText, body}: NetworkCacheEntry): Response {
    // Transform headers to Headers object:
    const newHeaders = new Headers();
    Object.entries(headers).forEach(([key, value]) => {
        newHeaders.append(key, value);
    });

    return new Response(body, {
        status,
        statusText,
        headers: newHeaders,
    });
}

/**
 * This function hashes the arguments of fetch.
 */
function hashFetchArgs(args: Parameters<typeof fetch>) {
    const url = fetchArgsGetUrl(args);
    const options = fetchArgsGetRequestInit(args);
    const headers = getFetchRequestHeadersAsObject(options);
    // Note: earlier we were using the body value as well, however
    // the body for the same request might be different due to including
    // times or app versions.
    return `${url}${JSON.stringify(headers)}`;
}

export default function installNetworkInterceptor(
    getNetworkCache: () => Promise<NetworkCacheMap>,
    updateNetworkCache: (networkCache: NetworkCacheMap) => Promise<unknown>,
    shouldReturnRecordedResponse: boolean,
) {
    console.debug(LOG_TAG, 'installing with shouldReturnRecordedResponse:', shouldReturnRecordedResponse);
    const originalFetch = global.fetch;

    if (networkCache == null && shouldReturnRecordedResponse) {
        console.debug(LOG_TAG, 'fetching network cache …');
        getNetworkCache()
            .then((newCache) => {
                networkCache = newCache;
                globalResolveIsNetworkInterceptorInstalled();
                console.debug(LOG_TAG, 'network cache fetched!');
            }, globalRejectIsNetworkInterceptorInstalled)
            .catch(globalRejectIsNetworkInterceptorInstalled);
    } else {
        networkCache = {};
        globalResolveIsNetworkInterceptorInstalled();
    }

    // @ts-expect-error Fetch global types weirdly include URL
    global.fetch = async (...args: Parameters<typeof fetch>) => {
        const options = fetchArgsGetRequestInit(args);
        const headers = getFetchRequestHeadersAsObject(options);
        const url = fetchArgsGetUrl(args);
        // Check if headers contain any of the ignored headers, or if react native metro server:
        if (IGNORE_REQUEST_HEADERS.some((header) => headers[header] != null) || url.includes('8081')) {
            return originalFetch(...args);
        }

        await globalIsNetworkInterceptorInstalledPromise;

        const hash = hashFetchArgs(args);
        const cachedResponse = networkCache?.[hash];
        if (shouldReturnRecordedResponse && cachedResponse != null) {
            const response = networkCacheEntryToResponse(cachedResponse);
            console.debug(LOG_TAG, 'Returning recorded response for url:', url);
            return Promise.resolve(response);
        }
        if (shouldReturnRecordedResponse) {
            console.debug('!!! Missed cache hit for url:', url);
        }

        return originalFetch(...args)
            .then(async (res) => {
                if (networkCache != null) {
                    const body = await res.clone().text();
                    networkCache[hash] = {
                        url,
                        options,
                        body,
                        headers: getFetchRequestHeadersAsObject(options),
                        status: res.status,
                        statusText: res.statusText,
                    };
                    console.debug(LOG_TAG, 'Updating network cache for url:', url);
                    // Send the network cache to the test server:
                    return updateNetworkCache(networkCache).then(() => res);
                }
                return res;
            })
            .then((res) => {
                console.debug(LOG_TAG, 'Network cache updated!');
                return res;
            });
    };
}
