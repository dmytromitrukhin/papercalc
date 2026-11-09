import './style.css';
import paperTypes from './constants/paperTypes.js';
import { calculatePaper } from './core/calculate-paper.js';

const form = document.querySelector('#paper-form');
const paperSelect = form.elements.paperName;
const typeSelect = form.elements.paperType;
const weightSelect = form.elements.paperWeight;
const previewPaper = document.querySelector('#preview-paper');
const previewType = document.querySelector('#preview-type');
const previewWeight = document.querySelector('#preview-weight');
const resultSheets = document.querySelector('#result-sheets');
const resultInches = document.querySelector('#result-inches');
const resultMm = document.querySelector('#result-mm');
const resultElements = document.querySelector('#result-elements');
const resultMessage = document.querySelector('#result-message');
const resultDetails = document.querySelector('#result-details');
const resultLayout = document.querySelector('#result-layout');
const calculationStatus = document.querySelector('#calculation-status');
const visualizer = document.querySelector('#paper-visualizer');
const visualizerSize = document.querySelector('#visualizer-size');
const visualizerNote = document.querySelector('#visualizer-note');
const integerFormat = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
const inchFormat = new Intl.NumberFormat('en-US', { minimumFractionDigits: 3, maximumFractionDigits: 3 });
const mmFormat = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const grainLabels = { any: 'Any', lg: 'Long Grain (LG)', sg: 'Short Grain (SG)' };
let displayedGeometryKey = null;
let pendingRender = null;
let announcementTimer = null;

function createOption(value, label = value) {
    const option = document.createElement('option');
    option.value = String(value);
    option.textContent = label;
    return option;
}

function replaceOptions(select, options) {
    const previous = select.value;
    select.replaceChildren(...options);
    if (options.some((option) => option.value === previous)) select.value = previous;
}

function getCurrentPaper() {
    return paperTypes.find((paper) => paper.name === paperSelect.value);
}

function getCurrentType(paper) {
    return paper?.details?.find((detail) => detail.type === typeSelect.value);
}

function getCurrentWeight(type) {
    return type?.weights?.find((weight) => String(weight.value) === weightSelect.value);
}

function fillPaperList() {
    replaceOptions(paperSelect, paperTypes.map((paper) => createOption(paper.name)));
}

function fillTypeList() {
    const details = getCurrentPaper()?.details ?? [];
    replaceOptions(typeSelect, details.map((detail) => createOption(detail.type)));
}

function fillWeightList() {
    const type = getCurrentType(getCurrentPaper());
    replaceOptions(weightSelect, (type?.weights ?? []).map((weight) => createOption(weight.value, `${weight.value} lb`)));
}

function readCalculationInput() {
    const data = Object.fromEntries(new FormData(form));
    return {
        ...data,
        paperTypes,
        selectedPaper: data.paperName,
        selectedType: data.paperType,
        selectedWeight: data.paperWeight,
    };
}

function updatePreview() {
    const paper = getCurrentPaper();
    const type = getCurrentType(paper);
    const weight = getCurrentWeight(type);
    previewPaper.textContent = paper?.name ?? '—';
    previewType.textContent = type?.type ?? '—';
    previewWeight.textContent = weight ? `${weight.value} lb` : '—';
}

function createSvgElement(tagName, attributes = {}) {
    const element = document.createElementNS('http://www.w3.org/2000/svg', tagName);
    for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, String(value));
    return element;
}

function clearVisualizer() {
    if (displayedGeometryKey !== null) visualizer.replaceChildren();
    displayedGeometryKey = null;
    visualizer.setAttribute('hidden', '');
    visualizerSize.textContent = '—';
    visualizerNote.textContent = 'Enter valid dimensions to see the layout.';
}

function transformRectForLandscape(rect, sheetWidth, sheetHeight) {
    if (sheetWidth >= sheetHeight) return rect;
    // Display-only quarter turn. The original sheet axes remain in the caption.
    return {
        ...rect,
        x: rect.y,
        y: sheetWidth - rect.x - rect.width,
        width: rect.height,
        height: rect.width,
    };
}

function insetRectForCrop(rect, result) {
    const gapX = rect.rotated ? result.cropLength : result.cropWidth;
    const gapY = rect.rotated ? result.cropWidth : result.cropLength;
    return {
        ...rect,
        x: rect.x + gapX / 2,
        y: rect.y + gapY / 2,
        width: rect.rotated ? result.finishLength : result.finishWidth,
        height: rect.rotated ? result.finishWidth : result.finishLength,
    };
}

function appendDisplayRect(parent, rect, result, className) {
    const display = transformRectForLandscape(rect, result.startWidth, result.startLength);
    parent.append(createSvgElement('rect', {
        x: display.x, y: display.y, width: display.width, height: display.height,
        class: className,
    }));
}

function drawVisualizer(result) {
    if (!result.ok) {
        clearVisualizer();
        return;
    }
    if (displayedGeometryKey === result.geometryKey) return;

    const portrait = result.startWidth < result.startLength;
    const viewWidth = portrait ? result.startLength : result.startWidth;
    const viewHeight = portrait ? result.startWidth : result.startLength;
    const fragment = document.createDocumentFragment();
    const title = createSvgElement('title', { id: 'layout-title' });
    title.textContent = `${integerFormat.format(result.numberOfElements)} finished blanks per stock sheet`;
    const description = createSvgElement('desc', { id: 'layout-description' });
    description.textContent = `Stock ${result.startWidth} by ${result.startLength} inches. ` +
        `Finished blank ${result.finishWidth} by ${result.finishLength} inches. ` +
        `Total width allowance ${result.cropWidth}, total length allowance ${result.cropLength} inches. ` +
        `Grain: ${grainLabels[result.grainDirection]}. ` +
        (result.grainAxis ? `Grain follows the entered stock ${result.grainAxis}; finished long edges are perpendicular to it. ` : '') +
        `${result.layoutName}. ${portrait ? 'Sheet turned for display. ' : ''}` +
        (result.previewSimplified ? 'Dense preview shows occupied grid regions, including allowances, rather than individual blanks.' : 'Gold blanks are unrotated; blue blanks are rotated 90 degrees relative to the entered stock axes.');
    fragment.append(title, description, createSvgElement('rect', {
        x: 0, y: 0, width: viewWidth, height: viewHeight, class: 'svg-sheet',
    }));

    if (result.previewSimplified) {
        // Constant DOM size even for millions of blanks. Grid origins, pitches
        // and counts are retained in the calculation; never invent larger blanks.
        for (const item of result.layoutGrids) {
            appendDisplayRect(fragment, item, result, item.rotated ? 'svg-grid svg-grid-rotated' : 'svg-grid');
        }
    } else {
        const hasAllowance = result.cropWidth > 0 || result.cropLength > 0;
        for (const rect of result.layoutRects) {
            if (hasAllowance) appendDisplayRect(fragment, rect, result, 'svg-allowance');
            appendDisplayRect(fragment, insetRectForCrop(rect, result), result,
                rect.rotated ? 'svg-piece svg-piece-rotated' : 'svg-piece');
        }
    }

    visualizer.setAttribute('viewBox', `0 0 ${viewWidth} ${viewHeight}`);
    visualizer.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    visualizer.style.aspectRatio = `${viewWidth} / ${viewHeight}`;
    // Long formats can scroll horizontally instead of shrinking to a thin line.
    // Bound the display surface as well as the calculation work.
    visualizer.style.minWidth = `${Math.min(2048, (viewWidth / viewHeight) * 80)}px`;
    visualizer.replaceChildren(fragment);
    visualizer.removeAttribute('hidden');
    visualizerSize.textContent = `Stock: ${result.startWidth} × ${result.startLength} in`;
    const notes = [];
    if (portrait) notes.push('Sheet turned for display; dimensions above use the entered stock axes.');
    if (result.grainAxis) notes.push(`${grainLabels[result.grainDirection]}: grain follows the entered stock ${result.grainAxis}; finished long edges cross it at 90°.`);
    if (result.previewSimplified) {
        notes.push('Dense preview: shaded regions show complete grids, including allowances. Individual blanks are not drawn.');
        for (const item of result.layoutGrids) {
            notes.push(`${integerFormat.format(item.columns)} columns × ${integerFormat.format(item.rows)} rows, ${item.rotated ? 'rotated' : 'unrotated'}; cell ${item.itemWidth} × ${item.itemHeight} in.`);
        }
    } else {
        notes.push('Solid shapes show finished blanks; dashed outlines include the total allowances.');
    }
    visualizerNote.textContent = notes.join(' ');
    displayedGeometryKey = result.geometryKey;
}

function renderFieldErrors(errors = {}) {
    for (const field of form.elements) {
        const message = errors[field.name] ?? '';
        if (message) field.setAttribute('aria-invalid', 'true');
        else field.removeAttribute('aria-invalid');
        const error = document.getElementById(`${field.name}-error`);
        if (error) error.textContent = message;
    }
}

function announce(message) {
    window.clearTimeout(announcementTimer);
    announcementTimer = window.setTimeout(() => {
        if (calculationStatus.textContent !== message) calculationStatus.textContent = message;
    }, 450);
}

function renderCalculation() {
    updatePreview();
    const result = calculatePaper(readCalculationInput());
    renderFieldErrors(result.fieldErrors);
    resultMessage.textContent = result.ok ? '' : result.message;
    resultMessage.hidden = result.ok;

    if (!result.ok) {
        for (const output of [resultSheets, resultInches, resultMm, resultElements]) output.textContent = '—';
        resultDetails.textContent = '';
        resultLayout.textContent = '';
        drawVisualizer(result);
        announce(Object.values(result.fieldErrors ?? {})[0] ?? result.message);
        return;
    }

    resultSheets.textContent = integerFormat.format(result.totalSheetsNeeded);
    resultInches.textContent = inchFormat.format(result.totalInches);
    resultMm.textContent = mmFormat.format(result.totalMm);
    resultElements.textContent = integerFormat.format(result.numberOfElements);
    resultDetails.textContent = `Finished blanks: ${integerFormat.format(result.producedSheets)} · Extra blanks: ${integerFormat.format(result.extraSheets)}.`;
    resultLayout.textContent = `Grain: ${grainLabels[result.grainDirection]}. Best checked layout: ${result.layoutName}. Baseline: ${integerFormat.format(result.baselineElements)} blanks/sheet.` +
        (result.optimizationLimited ? ' Search limited for this dense format: some strip boundaries were skipped.' : '');
    drawVisualizer(result);
    announce(`Grain: ${grainLabels[result.grainDirection]}. ${integerFormat.format(result.totalSheetsNeeded)} stock sheets required, ${integerFormat.format(result.numberOfElements)} blanks per sheet. Stack height ${mmFormat.format(result.totalMm)} millimetres.`);
}

function scheduleCalculation() {
    if (pendingRender !== null) return;
    pendingRender = window.requestAnimationFrame(() => {
        pendingRender = null;
        renderCalculation();
    });
}

function handlePaperChange() {
    fillTypeList();
    fillWeightList();
}

function handleTypeChange() {
    fillWeightList();
}

function init() {
    fillPaperList();
    fillTypeList();
    fillWeightList();

    // Select input events are ignored until dependent lists have been updated.
    form.addEventListener('input', (event) => {
        if (event.target instanceof HTMLInputElement) scheduleCalculation();
    });
    form.addEventListener('change', (event) => {
        if (!(event.target instanceof HTMLSelectElement)) return;
        if (event.target === paperSelect) handlePaperChange();
        else if (event.target === typeSelect) handleTypeChange();
        scheduleCalculation();
    });
    form.addEventListener('submit', (event) => event.preventDefault());
    renderCalculation();
}

init();
