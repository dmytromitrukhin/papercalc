// Geometry is calculated in integer thousandths of an inch, never in SVG units.
const UNITS_PER_INCH = 1000;
const MAX_DIMENSION_INCHES = 10_000;
const MAX_REQUIRED_SHEETS = 1_000_000_000;
const MAX_PREVIEW_RECTS = 2000;
const MAX_BOUNDARIES_PER_AXIS = 10_000;

// One geometry entry is enough for repeated quantity/material changes.
let cachedGeometry = null;

function parseDecimal(value, decimalPlaces, maximum) {
    if (typeof value !== 'string' && typeof value !== 'number') return null;
    const text = String(value).trim();
    if (!text || text.length > 64) return null;

    const match = /^([+-]?)(?:(\d+)(?:\.(\d*))?|\.(\d+))(?:e([+-]?\d+))?$/i.exec(text);
    if (!match) return null;

    const fraction = match[3] ?? match[4] ?? '';
    const exponent = Number(match[5] ?? 0);
    if (!Number.isInteger(exponent) || Math.abs(exponent) > 100) return null;

    let units = BigInt((match[2] ?? '0') + fraction);
    const shift = decimalPlaces + exponent - fraction.length;
    if (shift >= 0) {
        units *= 10n ** BigInt(shift);
    } else {
        const divisor = 10n ** BigInt(-shift);
        if (units % divisor !== 0n) return null;
        units /= divisor;
    }
    if (match[1] === '-') units = -units;
    if (units < 0n || units > BigInt(maximum)) return null;
    return Number(units);
}

function findWeightDetail(paperTypes, selectedPaper, selectedType, selectedWeight) {
    const paper = paperTypes?.find((item) => item.name === selectedPaper);
    const type = paper?.details?.find((detail) => detail.type === selectedType);
    return type?.weights?.find((weight) => String(weight.value) === String(selectedWeight)) ?? null;
}

function readDimensions(input, fieldErrors) {
    const dimensions = {};
    const labels = {
        startWidth: 'Stock width', startLength: 'Stock length',
        finishWidth: 'Finished width', finishLength: 'Finished length',
        cropWidth: 'Width allowance', cropLength: 'Length allowance',
    };

    for (const [name, label] of Object.entries(labels)) {
        const units = parseDecimal(input[name], 3, MAX_DIMENSION_INCHES * UNITS_PER_INCH);
        const minimum = name.startsWith('crop') ? 0 : 1;
        if (units === null || units < minimum) {
            fieldErrors[name] = `${label}: enter ${minimum / UNITS_PER_INCH}–${MAX_DIMENSION_INCHES} in, in steps of 0.001.`;
        } else {
            dimensions[name] = units;
        }
    }
    return dimensions;
}

function resolveGrainConstraint(dimensions, direction) {
    if (direction === 'any') {
        return { ok: true, direction, axis: null, allowedRotations: [false, true] };
    }

    const squareParts = [];
    if (dimensions.startWidth === dimensions.startLength) squareParts.push('stock sheet');
    if (dimensions.finishWidth === dimensions.finishLength) squareParts.push('finished blank');
    if (squareParts.length) {
        const message = `Grain direction is ambiguous for a square ${squareParts.join(' and ')}. Choose Any to calculate without a grain constraint.`;
        return { ok: false, message, fieldErrors: { grainDirection: message } };
    }

    const stockLongAxis = dimensions.startWidth > dimensions.startLength ? 'width' : 'length';
    const axis = direction === 'lg' ? stockLongAxis : (stockLongAxis === 'width' ? 'length' : 'width');
    // Allowances affect the occupied cell, not the finished blank's long edge.
    // These are the entered stock axes, before the display-only SVG rotation.
    const normalLongAxis = dimensions.finishWidth > dimensions.finishLength ? 'width' : 'length';
    return { ok: true, direction, axis, allowedRotations: [normalLongAxis === axis] };
}

function isLayoutAllowed(candidate, grain) {
    return candidate.grids.every((item) => grain.allowedRotations.includes(item.rotated));
}

function grid(x, y, columns, rows, itemWidth, itemHeight, rotated) {
    return { x, y, columns, rows, itemWidth, itemHeight, rotated };
}

function layout(name, grids, strategy = 'baseline') {
    const occupiedGrids = grids.filter((item) => item.columns > 0 && item.rows > 0);
    return {
        name,
        strategy,
        grids: occupiedGrids,
        count: occupiedGrids.reduce((sum, item) => sum + item.columns * item.rows, 0),
    };
}

// The original six layouts remain the baseline, including their tie order.
// Only compact grid descriptions are allocated while comparing candidates.
function createLayoutCandidates({ startWidth, startLength, adjustedFinishWidth: w, adjustedFinishLength: h }) {
    const normalColumns = Math.floor(startWidth / w);
    const normalRows = Math.floor(startLength / h);
    const rotatedColumns = Math.floor(startWidth / h);
    const rotatedRows = Math.floor(startLength / w);
    const normal = grid(0, 0, normalColumns, normalRows, w, h, false);
    const rotated = grid(0, 0, rotatedColumns, rotatedRows, h, w, true);

    return [
        layout('normal + bottom rotated strip', [normal,
            grid(0, normalRows * h, rotatedColumns, Math.floor((startLength - normalRows * h) / w), h, w, true)]),
        layout('normal + right rotated strip', [normal,
            grid(normalColumns * w, 0, Math.floor((startWidth - normalColumns * w) / h), rotatedRows, h, w, true)]),
        layout('rotated + right normal strip', [rotated,
            grid(rotatedColumns * h, 0, Math.floor((startWidth - rotatedColumns * h) / w), normalRows, w, h, false)]),
        layout('rotated + bottom normal strip', [rotated,
            grid(0, rotatedRows * w, normalColumns, Math.floor((startLength - rotatedRows * w) / h), w, h, false)]),
        layout('normal only', [normal]),
        layout('rotated only', [rotated]),
    ];
}

function findBestStripLayout(dimensions, baseline, grain) {
    const { startWidth, startLength, adjustedFinishWidth: w, adjustedFinishLength: h } = dimensions;
    const areaUpperBound = Math.floor((startWidth * startLength) / (w * h));
    let best = baseline;
    let searchLimited = false;

    // With one permitted orientation, all mixed candidates are inadmissible.
    // Their single-orientation endpoints are already covered by the base grids.
    if (grain.allowedRotations.length === 1) return { best, searchLimited };

    if (best.count === areaUpperBound || w === h ||
        w > startWidth || h > startLength || h > startWidth || w > startLength) {
        return { best, searchLimited };
    }

    for (const axis of ['horizontal', 'vertical']) {
        const horizontal = axis === 'horizontal';
        const extent = horizontal ? startLength : startWidth;
        const across = horizontal ? startWidth : startLength;
        const normal = { width: w, height: h, rotated: false };
        const rotated = { width: h, height: w, rotated: true };
        const depth = (item) => horizontal ? item.height : item.width;
        const breadth = (item) => horizontal ? item.width : item.height;
        // Enumerating the orientation with fewer lines covers the same two-group
        // counts: each split fills the remaining space with the other orientation.
        const [first, second] = depth(normal) >= depth(rotated) ? [normal, rotated] : [rotated, normal];
        const firstAcross = Math.floor(across / breadth(first));
        const secondAcross = Math.floor(across / breadth(second));
        const maxLines = Math.floor(extent / depth(first));
        const step = Math.max(1, Math.ceil(maxLines / MAX_BOUNDARIES_PER_AXIS));
        searchLimited ||= step > 1;

        const considerBoundary = (lines) => {
            const split = lines * depth(first);
            const otherLines = Math.floor((extent - split) / depth(second));
            const count = lines * firstAcross + otherLines * secondAcross;
            if (count <= best.count) return;

            const candidate = layout(`mixed ${axis} strips`, horizontal ? [
                grid(0, 0, firstAcross, lines, first.width, first.height, first.rotated),
                grid(0, split, secondAcross, otherLines, second.width, second.height, second.rotated),
            ] : [
                grid(0, 0, lines, firstAcross, first.width, first.height, first.rotated),
                grid(split, 0, otherLines, secondAcross, second.width, second.height, second.rotated),
            ], 'mixed-strips');
            if (isLayoutAllowed(candidate, grain)) best = candidate;
        };

        for (let lines = 0; lines <= maxLines; lines += step) {
            considerBoundary(lines);
            if (best.count === areaUpperBound) return { best, searchLimited: false };
        }
        considerBoundary(maxLines);
    }

    return { best, searchLimited: best.count < areaUpperBound && searchLimited };
}

function createGridRects(grids) {
    const rects = [];
    for (const item of grids) {
        for (let row = 0; row < item.rows; row += 1) {
            for (let column = 0; column < item.columns; column += 1) {
                rects.push({
                    x: (item.x + column * item.itemWidth) / UNITS_PER_INCH,
                    y: (item.y + row * item.itemHeight) / UNITS_PER_INCH,
                    width: item.itemWidth / UNITS_PER_INCH,
                    height: item.itemHeight / UNITS_PER_INCH,
                    rotated: item.rotated,
                });
            }
        }
    }
    return rects;
}

function calculateGeometry(dimensions, grain) {
    const geometryKey = `${Object.values(dimensions).join(':')}:${grain.direction}`;
    if (cachedGeometry?.geometryKey === geometryKey) return cachedGeometry;

    const adjusted = {
        ...dimensions,
        adjustedFinishWidth: dimensions.finishWidth + dimensions.cropWidth,
        adjustedFinishLength: dimensions.finishLength + dimensions.cropLength,
    };
    const baseline = createLayoutCandidates(adjusted)
        .filter((candidate) => isLayoutAllowed(candidate, grain))
        .reduce((best, current) => current.count > best.count ? current : best);
    const { best, searchLimited } = findBestStripLayout(adjusted, baseline, grain);
    if (best.count === 0) {
        const message = grain.direction === 'any'
            ? 'No finished blank fits on this stock sheet with the entered allowances.'
            : `No finished blank fits on this stock sheet with the entered allowances and ${grain.direction.toUpperCase()} grain constraint.`;
        return { ok: false, message, fieldErrors: {} };
    }

    // A grid descriptor retains exact origins, pitches and counts even when the
    // preview is too dense to allocate individual rectangles. SVG shows regions.
    const previewSimplified = best.count > MAX_PREVIEW_RECTS;
    cachedGeometry = {
        ok: true,
        geometryKey,
        grainDirection: grain.direction,
        grainAxis: grain.axis,
        ...Object.fromEntries(Object.entries(adjusted).map(([key, value]) => [key, value / UNITS_PER_INCH])),
        numberOfElements: best.count,
        baselineElements: baseline.count,
        layoutName: best.name,
        layoutStrategy: best.strategy,
        optimizationLimited: searchLimited,
        previewSimplified,
        layoutRects: previewSimplified ? [] : createGridRects(best.grids),
        layoutGrids: best.grids.map((item) => ({
            ...item,
            x: item.x / UNITS_PER_INCH,
            y: item.y / UNITS_PER_INCH,
            itemWidth: item.itemWidth / UNITS_PER_INCH,
            itemHeight: item.itemHeight / UNITS_PER_INCH,
            width: item.columns * item.itemWidth / UNITS_PER_INCH,
            height: item.rows * item.itemHeight / UNITS_PER_INCH,
        })),
    };
    return cachedGeometry;
}

export function calculatePaper(input) {
    const fieldErrors = {};
    const dimensions = readDimensions(input, fieldErrors);
    const grainDirection = input.grainDirection ?? 'any';
    if (!['any', 'lg', 'sg'].includes(grainDirection)) {
        fieldErrors.grainDirection = 'Choose Any, Long Grain (LG) or Short Grain (SG).';
    }
    const requiredSheetsNumber = parseDecimal(input.requiredSheets, 0, MAX_REQUIRED_SHEETS);
    if (requiredSheetsNumber === null || requiredSheetsNumber === 0) {
        fieldErrors.requiredSheets = `Enter a whole number of finished blanks from 1 to ${MAX_REQUIRED_SHEETS.toLocaleString('en-US')}.`;
    }

    const weightDetail = findWeightDetail(input.paperTypes, input.selectedPaper, input.selectedType, input.selectedWeight);
    if (!weightDetail || !Number.isFinite(weightDetail.pricePerUnit) || weightDetail.pricePerUnit <= 0) {
        fieldErrors.paperWeight = 'Select a material with a valid paper coefficient.';
    }
    if (Object.keys(fieldErrors).length) {
        return { ok: false, message: 'Check the highlighted fields to calculate paper requirements.', fieldErrors };
    }

    const grain = resolveGrainConstraint(dimensions, grainDirection);
    if (!grain.ok) return grain;

    const geometry = calculateGeometry(dimensions, grain);
    if (!geometry.ok) return geometry;

    // Ceiling division in integers avoids a rounded fractional stock sheet.
    const required = BigInt(requiredSheetsNumber);
    const perSheet = BigInt(geometry.numberOfElements);
    const totalSheetsNeeded = Number((required + perSheet - 1n) / perSheet);
    const producedSheets = totalSheetsNeeded * geometry.numberOfElements;
    // Preserve the existing coefficient and /100 convention. Its physical unit
    // is not documented in paperTypes.js; do not reinterpret or rename the data.
    const totalInches = totalSheetsNeeded * (weightDetail.pricePerUnit / 100);
    const totalMm = totalInches * 25.4;
    if (!Number.isFinite(totalInches) || !Number.isFinite(totalMm)) {
        return { ok: false, message: 'The paper coefficient produces an out-of-range stack height.', fieldErrors: {} };
    }

    return {
        ...geometry,
        requiredSheets: requiredSheetsNumber,
        totalSheetsNeeded,
        theoreticalSheetsNeeded: requiredSheetsNumber / geometry.numberOfElements,
        producedSheets,
        extraSheets: producedSheets - requiredSheetsNumber,
        totalInches,
        totalMm,
        selectedPaper: input.selectedPaper,
        selectedType: input.selectedType,
        selectedWeight: Number(input.selectedWeight),
        pricePerUnit: weightDetail.pricePerUnit,
    };
}
