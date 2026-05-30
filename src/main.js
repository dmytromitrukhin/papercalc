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

const resultInches = document.querySelector('#result-inches');
const resultMm = document.querySelector('#result-mm');
const resultElements = document.querySelector('#result-elements');
const resultMessage = document.querySelector('#result-message');

const visualizer = document.querySelector('#paper-visualizer');
const visualizerSize = document.querySelector('#visualizer-size');

function createOption(value, label = value) {
    const option = document.createElement('option');

    option.value = String(value);
    option.textContent = label;

    return option;
}

function getCurrentPaper() {
    return paperTypes.find((paper) => paper.name === paperSelect.value) ?? paperTypes[0];
}

function getCurrentType(paper) {
    return paper.details.find((detail) => detail.type === typeSelect.value) ?? paper.details[0];
}

function getCurrentWeight(type) {
    return type.weights.find((weight) => String(weight.value) === weightSelect.value) ?? type.weights[0];
}

function fillPaperList() {
    paperSelect.replaceChildren();

    for (const paper of paperTypes) {
        paperSelect.append(createOption(paper.name));
    }
}

function fillTypeList() {
    const paper = getCurrentPaper();

    typeSelect.replaceChildren();

    for (const detail of paper.details) {
        typeSelect.append(createOption(detail.type));
    }
}

function fillWeightList() {
    const paper = getCurrentPaper();
    const type = getCurrentType(paper);

    weightSelect.replaceChildren();

    for (const weight of type.weights) {
        weightSelect.append(createOption(weight.value, `${weight.value} lb`));
    }
}

function readCalculationInput() {
    const formData = new FormData(form);

    return {
        paperTypes,

        selectedPaper: formData.get('paperName'),
        selectedType: formData.get('paperType'),
        selectedWeight: formData.get('paperWeight'),

        requiredSheets: formData.get('requiredSheets'),

        startWidth: formData.get('startWidth'),
        startLength: formData.get('startLength'),

        finishWidth: formData.get('finishWidth'),
        finishLength: formData.get('finishLength'),

        cropWidth: formData.get('cropWidth'),
        cropLength: formData.get('cropLength'),
    };
}

function updatePreview() {
    const paper = getCurrentPaper();
    const type = getCurrentType(paper);
    const weight = getCurrentWeight(type);

    previewPaper.textContent = paper.name;
    previewType.textContent = type.type;
    previewWeight.textContent = `${weight.value} lb`;
}

function createSvgElement(tagName, attributes = {}) {
    const element = document.createElementNS('http://www.w3.org/2000/svg', tagName);

    for (const [name, value] of Object.entries(attributes)) {
        element.setAttribute(name, String(value));
    }

    return element;
}

function clearVisualizer() {
    if (!visualizer) {
        return;
    }

    visualizer.replaceChildren();
}

function transformRectForLandscape(rect, sheetWidth, sheetHeight) {
    const isAlreadyLandscape = sheetWidth >= sheetHeight;

    if (isAlreadyLandscape) {
        return rect;
    }

    // Rotate rectangle 90 degrees clockwise for display only.
    // Calculation data stays unchanged.
    const rotatedX = rect.y;
    const rotatedY = sheetWidth - rect.x - rect.width;
    const rotatedWidth = rect.height;
    const rotatedHeight = rect.width;

    return {
        x: rotatedX,
        y: rotatedY,
        width: rotatedWidth,
        height: rotatedHeight,
        rotated: rect.rotated,
    };
}

function insetRectForCrop(rect, result) {
    const sourceGapX = rect.rotated ? result.cropLength : result.cropWidth;
    const sourceGapY = rect.rotated ? result.cropWidth : result.cropLength;

    const gapX = Math.min(Math.max(sourceGapX, 0), rect.width * 0.45);
    const gapY = Math.min(Math.max(sourceGapY, 0), rect.height * 0.45);

    return {
        ...rect,
        x: rect.x + gapX / 2,
        y: rect.y + gapY / 2,
        width: Math.max(rect.width - gapX, 0.001),
        height: Math.max(rect.height - gapY, 0.001),
    };
}

function drawVisualizer(result) {
    if (!visualizer || !visualizerSize) {
        return;
    }

    clearVisualizer();

    if (!result.ok) {
        visualizerSize.textContent = '—';
        return;
    }

    const isPortraitSheet = result.startWidth < result.startLength;

    const viewWidth = isPortraitSheet ? result.startLength : result.startWidth;
    const viewHeight = isPortraitSheet ? result.startWidth : result.startLength;

    visualizer.setAttribute('viewBox', `0 0 ${viewWidth} ${viewHeight}`);

    visualizer.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    visualizer.style.aspectRatio = `${viewWidth} / ${viewHeight}`;

    visualizerSize.textContent = `${viewWidth} × ${viewHeight} in`;

    const sheet = createSvgElement('rect', {
        x: 0,
        y: 0,
        width: viewWidth,
        height: viewHeight,
        class: 'svg-sheet',
    });

    visualizer.append(sheet);

    for (const rect of result.layoutRects) {
        const cropInsetRect = insetRectForCrop(rect, result);

        const displayRect = transformRectForLandscape(
            cropInsetRect,
            result.startWidth,
            result.startLength,
        );

        const piece = createSvgElement('rect', {
            x: displayRect.x,
            y: displayRect.y,
            width: displayRect.width,
            height: displayRect.height,
            class: displayRect.rotated ? 'svg-piece svg-piece-rotated' : 'svg-piece',
        });

        visualizer.append(piece);
    }
}

function renderCalculation() {
    updatePreview();

    const result = calculatePaper(readCalculationInput());

    if (!result.ok) {
        resultInches.textContent = '—';
        resultMm.textContent = '—';
        resultElements.textContent = '—';
        resultMessage.textContent = result.message;

        drawVisualizer(result);
        return;
    }

    resultInches.textContent = result.totalInches.toFixed(3);
    resultMm.textContent = result.totalMm.toFixed(2);
    resultElements.textContent = result.numberOfElements;

    /*resultMessage.textContent =
        `Price per unit: ${result.pricePerUnit}. ` +
        `Adjusted finish size: ${result.adjustedFinishWidth} × ${result.adjustedFinishLength} in. ` +
        `Layout: ${result.layoutName}.`;*/

    drawVisualizer(result);
}

function handlePaperChange() {
    fillTypeList();
    fillWeightList();
    renderCalculation();
}

function handleTypeChange() {
    fillWeightList();
    renderCalculation();
}

function init() {
    fillPaperList();
    fillTypeList();
    fillWeightList();

    paperSelect.addEventListener('change', handlePaperChange);
    typeSelect.addEventListener('change', handleTypeChange);
    weightSelect.addEventListener('change', renderCalculation);

    form.addEventListener('input', renderCalculation);
    form.addEventListener('change', renderCalculation);

    renderCalculation();
}

init();