/*
 * Copyright (c) 2014-2015 Thomas Kern
 *
 * Permission is hereby granted, free of charge, to any person obtaining a
 * copy of this software and associated documentation files (the "Software"),
 * to deal in the Software without restriction, including without limitation
 * the rights to use, copy, modify, merge, publish, distribute, sublicense,
 * and/or sell copies of the Software, and to permit persons to whom the
 * Software is furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
 * FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER
 * DEALINGS IN THE SOFTWARE.
 */

/*
 * This file contains everything necessary to execute asciidoctor.js in a
 * a webworker thread.
 */

/*global Opal, importScripts, postMessage */
/*jshint -W079, -W098 */

/** Webworkers do not have access to 'console', but Opal needs it. */

var console = {
    messages: [],
    log: function (m) {
        this.messages.push(String(m));
    },
    info: function (m) {
        this.messages.push(String(m));
    },
    warn: function (m) {
        this.messages.push(String(m));
    },
    error: function (m) {
        this.messages.push(String(m));
    },
    debug: function (m) {
        this.messages.push(String(m));
    },
    clear: function () {
        this.messages = [];
    }
};

var plantUmlServerUrl = '';

/**
 * Called by invoking 'postMessage' on the worker
 */
var onmessage = function (e) {
    postMessage(convert(e.data));
};

/**
 * Actual conversion is done here
 */
function convert(data) {

    plantUmlServerUrl = data.plantUmlServerUrl;

    var startTime = new Date().getTime();
    console.clear();

    // communicate to Asciidoctor that the working directory is not the same as the preview file
    Opal.ENV['$[]=']("PWD", data.cwd);

    // options and attributes
    var opts = Opal.hash2(['base_dir', 'safe', 'doctype', 'sourcemap', 'header_footer', 'attributes'], {
        'base_dir': data.basedir,
        'safe': data.safemode,
        'doctype': data.doctype,
        'header_footer': data.header_footer,
        'sourcemap': true, // generate source map
        'attributes': data.attributes
    });

    var highlighter = '',
        usesStem = false,
        html = '',
        outline = null;

    try {
        var doc = Opal.Asciidoctor.$load(data.docText, opts);
        if (console.messages.length === 0) {
            outline = fetchOutline(doc);
        }

        var knownHighlighters = ['highlightjs', 'highlight.js', 'prettify', 'coderay', 'pygments'];

        if (doc.$attr) {
            usesStem = String(doc.$attr("stem")).length > 0;
            var sh = String(doc.$attr("source-highlighter"));
            if (sh.length > 0) {
                // Only "highlighjs", "highlight.js" or "prettify" may be used in JavaScript env.
                // "coderay" and "pygments" won't work here, but if the user explicitly
                // set them as an attribute, fallback to highlight.js with a warning
                var i = knownHighlighters.indexOf(sh);
                if (i === 0) {
                    i = 1;
                }

                if (i === 1 || i === 2) {
                    highlighter = knownHighlighters[i];
                } else if (i > 2) {
                    highlighter = knownHighlighters[1];
                    // FIXME: Changing attributes after $load() does not seem to work right now. 
                    //doc.$set_attribute('source-highlighter', highlighter);
                    //console.warn('Warning: source-highlighter "' + sh + '" is valid, but can not be used with live-preview. Using "' + highlighter + '".'); 
                    console.warn('Warning: source-highlighter "' + sh + '" is valid, but can not be used with live-preview. Try "highlight.js" or "prettify".');
                } else {
                    highlighter = '';
                    console.warn('Warning: Invalid value "' + sh + '" for attribute "source-highlighter"! Valid highlighters are: ' + knownHighlighters);
                }
            }
        }

        html = doc.$convert(); // convert!
    } catch (e) {
        console.error(e);
    }

    return {
        html: html,
        outline: outline, // add outline
        stem: usesStem,
        sourceHighlighter: highlighter,
        messages: console.messages,
        duration: new Date().getTime() - startTime
    };
}

/**
 * Fetch an outline from a document
 * @param   {Object} doc loaded Asciidoctor document
 * @returns {Array}  array of sectionInfo objects.
 */
function fetchOutline(doc) {
    var sectionInfo = [];

    var getBlockInfo = function (blocks) {
        var blockInfo = [];
        for (var i = 0; i < blocks.length && blocks[i].$node_name() !== 'section'; i++) {
            var ln = blocks[i].$lineno();
            // HACK: Line number of last block seems to be off by one
            if (i + 1 === blocks.length) {
                ln--;
            }
            blockInfo.push({
                lineno: ln
            });
        }
        return blockInfo;
    };

    var fillSections = function self(level, sections) {
        level++;
        if (level > 5) {
            return;
        }
        for (var i = 0; i < sections.length; i++) {
            sectionInfo.push({
                level: level,
                title: sections[i].$captioned_title(),
                lineno: sections[i].$lineno(),
                id: sections[i].$id(),
                blockInfo: getBlockInfo(sections[i].blocks)
            });
            self(level, sections[i].$sections());
        }
    };

    // Add information about document title and preamble blocks
    var titleInfo = {
        level: 0,
        title: doc.$doctitle(Opal.hash2(['sanitize'], {
            'sanitize': true
        })).$to_s(),
        lineno: 1,
        id: "content",
        blockInfo: []
    };

    if (doc.blocks.length > 0 && doc.blocks[0].$node_name() === 'preamble') {
        var preamble_blocks = doc.blocks[0].blocks;
        titleInfo.blockInfo = getBlockInfo(preamble_blocks);
    }

    sectionInfo.push(titleInfo);

    // Add information about sections and paragraphs within sections
    fillSections(0, doc.$sections());

    return sectionInfo;
}

// Import Opal and Asciidoctor.js
importScripts('asciidoctor-all.min.js');
importScripts('rawdeflate.js');
importScripts('plant-uml-invoker.js');
importScripts('diagram-extension.js');
