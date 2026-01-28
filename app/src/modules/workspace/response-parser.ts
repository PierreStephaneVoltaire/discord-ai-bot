export interface ResponsePart {
    type: 'text' | 'file';
    content: string;      // Text content or filename
    filePath?: string;    // Full path for file parts (relative to workspace)
}

/**
 * Parses model response for file markers like <<path/to/file.ext>>
 * Splits response into alternating text and file parts.
 */
export function parseResponse(response: string): ResponsePart[] {
    const parts: ResponsePart[] = [];
    const regex = /<<([^>]+)>>/g;

    let lastIndex = 0;
    let match;

    while ((match = regex.exec(response)) !== null) {
        // Add text before the marker
        const textBefore = response.substring(lastIndex, match.index);
        if (textBefore) {
            parts.push({ type: 'text', content: textBefore });
        }

        // Add the file part
        const filePath = match[1].trim();
        parts.push({
            type: 'file',
            content: filePath,
            filePath: filePath
        });

        lastIndex = regex.lastIndex;
    }

    // Add remaining text
    const remainingText = response.substring(lastIndex);
    if (remainingText) {
        parts.push({ type: 'text', content: remainingText });
    }

    // If no markers found, return single text part
    if (parts.length === 0 && response) {
        parts.push({ type: 'text', content: response });
    }

    return parts;
}
