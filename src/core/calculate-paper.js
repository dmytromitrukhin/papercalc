function toNumber(value) {
    const number = Number(value);

    if (Number.isNaN(number)) {
        return 0;
    }

    return number;
}

function findWeightDetail(paperTypes, selectedPaper, selectedType, selectedWeight) {
    const paper = paperTypes.find((item) => item.name === selectedPaper);

    if (!paper) {
        return null;
    }

    const type = paper.details.find((detail) => detail.type === selectedType);

    if (!type) {
        return null;
    }

    return type.weights.find((weight) => weight.value === Number(selectedWeight)) ?? null;
}

function createGridRects({
                             x,
                             y,
                             columns,
                             rows,
                             itemWidth,
                             itemHeight,
                             rotated,
                         }) {
    const rects = [];

    for (let row = 0; row < rows; row += 1) {
        for (let column = 0; column < columns; column += 1) {
            rects.push({
                x: x + column * itemWidth,
                y: y + row * itemHeight,
                width: itemWidth,
                height: itemHeight,
                rotated,
            });
        }
    }

    return rects;
}

function createLayoutCandidates({
                                    startWidth,
                                    startLength,
                                    adjustedFinishWidth,
                                    adjustedFinishLength,
                                }) {
    const normalColumns = Math.floor(startWidth / adjustedFinishWidth);
    const normalRows = Math.floor(startLength / adjustedFinishLength);


    const rotatedColumns = Math.floor(startWidth / adjustedFinishLength);
    const rotatedRows = Math.floor(startLength / adjustedFinishWidth);


    const normalRects = createGridRects({
        x: 0,
        y: 0,
        columns: normalColumns,
        rows: normalRows,
        itemWidth: adjustedFinishWidth,
        itemHeight: adjustedFinishLength,
        rotated: false,
    });

    const rotatedRects = createGridRects({
        x: 0,
        y: 0,
        columns: rotatedColumns,
        rows: rotatedRows,
        itemWidth: adjustedFinishLength,
        itemHeight: adjustedFinishWidth,
        rotated: true,
    });

    const bottomStripHeightNormal =
        startLength - normalRows * adjustedFinishLength;

    const bottomStripRectsNormal = createGridRects({
        x: 0,
        y: normalRows * adjustedFinishLength,
        columns: Math.floor(startWidth / adjustedFinishLength),
        rows: Math.floor(bottomStripHeightNormal / adjustedFinishWidth),
        itemWidth: adjustedFinishLength,
        itemHeight: adjustedFinishWidth,
        rotated: true,
    });

    const rightStripWidthNormal =
        startWidth - normalColumns * adjustedFinishWidth;

    const rightStripRectsNormal = createGridRects({
        x: normalColumns * adjustedFinishWidth,
        y: 0,
        columns: Math.floor(rightStripWidthNormal / adjustedFinishLength),
        rows: Math.floor(startLength / adjustedFinishWidth),
        itemWidth: adjustedFinishLength,
        itemHeight: adjustedFinishWidth,
        rotated: true,
    });

    const rightStripWidthRotated =
        startWidth - rotatedColumns * adjustedFinishLength;

    const rightStripRectsRotated = createGridRects({
        x: rotatedColumns * adjustedFinishLength,
        y: 0,
        columns: Math.floor(rightStripWidthRotated / adjustedFinishWidth),
        rows: Math.floor(startLength / adjustedFinishLength),
        itemWidth: adjustedFinishWidth,
        itemHeight: adjustedFinishLength,
        rotated: false,
    });

    const bottomStripHeightRotated =
        startLength - rotatedRows * adjustedFinishWidth;

    const bottomStripRectsRotated = createGridRects({
        x: 0,
        y: rotatedRows * adjustedFinishWidth,
        columns: Math.floor(startWidth / adjustedFinishWidth),
        rows: Math.floor(bottomStripHeightRotated / adjustedFinishLength),
        itemWidth: adjustedFinishWidth,
        itemHeight: adjustedFinishLength,
        rotated: false,
    });

    return [
        {
            name: 'normal + bottom rotated strip',
            rects: [...normalRects, ...bottomStripRectsNormal],
        },
        {
            name: 'normal + right rotated strip',
            rects: [...normalRects, ...rightStripRectsNormal],
        },
        {
            name: 'rotated + right normal strip',
            rects: [...rotatedRects, ...rightStripRectsRotated],
        },
        {
            name: 'rotated + bottom normal strip',
            rects: [...rotatedRects, ...bottomStripRectsRotated],
        },
        {
            name: 'normal only',
            rects: normalRects,
        },
        {
            name: 'rotated only',
            rects: rotatedRects,
        },
    ].map((layout) => ({
        ...layout,
        count: layout.rects.length,
    }));
}

export function calculatePaper({
                                   paperTypes,
                                   selectedPaper,
                                   selectedType,
                                   selectedWeight,
                                   requiredSheets,
                                   startWidth,
                                   startLength,
                                   finishWidth,
                                   finishLength,
                                   cropWidth,
                                   cropLength,
                               }) {
    const weightDetail = findWeightDetail(
        paperTypes,
        selectedPaper,
        selectedType,
        selectedWeight,
    );

    const requiredSheetsNumber = toNumber(requiredSheets);

    if (!weightDetail || requiredSheetsNumber <= 0) {
        return {
            ok: false,
            message:
                'Please ensure all selections are made and required sheets are entered correctly.',
        };
    }

    const startWidthNumber = toNumber(startWidth);
    const startLengthNumber = toNumber(startLength);
    const finishWidthNumber = toNumber(finishWidth);
    const finishLengthNumber = toNumber(finishLength);
    const cropWidthNumber = toNumber(cropWidth);
    const cropLengthNumber = toNumber(cropLength);

    if (
        startWidthNumber <= 0 ||
        startLengthNumber <= 0 ||
        finishWidthNumber <= 0 ||
        finishLengthNumber <= 0
    ) {
        return {
            ok: false,
            message: 'Please ensure all dimensions are entered correctly.',
        };
    }

    const adjustedFinishWidth = finishWidthNumber + cropWidthNumber;
    const adjustedFinishLength = finishLengthNumber + cropLengthNumber;

    const layoutCandidates = createLayoutCandidates({
        startWidth: startWidthNumber,
        startLength: startLengthNumber,
        adjustedFinishWidth,
        adjustedFinishLength,
    });

    const bestLayout = layoutCandidates.reduce((best, current) => {
        if (current.count > best.count) {
            return current;
        }

        return best;
    }, layoutCandidates[0]);

    const bestRatio = bestLayout.count;

    if (bestRatio === 0) {
        return {
            ok: false,
            message: 'Dimensions result in zero output. Please check your dimensions.',
        };
    }

    const totalSheetsNeeded = requiredSheetsNumber / bestRatio;
    const pricePerUnit = weightDetail.pricePerUnit / 100;
    const totalInches = totalSheetsNeeded * pricePerUnit;
    const totalMm = totalInches * 25.4;

    return {
        ok: true,

        numberOfElements: bestRatio,
        totalSheetsNeeded,
        totalInches,
        totalMm,

        selectedPaper,
        selectedType,
        selectedWeight: Number(selectedWeight),
        pricePerUnit: weightDetail.pricePerUnit,

        cropWidth: cropWidthNumber,
        cropLength: cropLengthNumber,
        finishWidth: finishWidthNumber,
        finishLength: finishLengthNumber,

        startWidth: startWidthNumber,
        startLength: startLengthNumber,
        adjustedFinishWidth,
        adjustedFinishLength,

        layoutName: bestLayout.name,
        layoutRects: bestLayout.rects,


    };
}