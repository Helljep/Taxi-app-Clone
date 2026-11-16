// Hungarian algorithm (Kuhn-Munkres, shortest augmenting path form), O(n^2 * m).
//
// Given a cost matrix (n rows, m columns, n <= m) it finds the one-to-one pairing of
// rows to columns with the SMALLEST TOTAL cost. For dispatch: rows are ride requests,
// columns are drivers, cost is the pickup time. Picking "the nearest driver for each
// ride, one after another" (greedy) can give one rider a great match and leave the
// next one with a terrible one. This finds the best combination for the whole batch.
//
// Returns an array: result[row] = column assigned to that row.

function hungarian(cost) {
    const n = cost.length;
    if (n === 0) return [];
    const m = cost[ 0 ].length;

    const u = new Float64Array(n + 1);   // row potentials
    const v = new Float64Array(m + 1);   // column potentials
    const owner = new Int32Array(m + 1); // owner[j] = row currently holding column j
    const way = new Int32Array(m + 1);

    for (let i = 1; i <= n; i++) {
        owner[ 0 ] = i;
        let j0 = 0;
        const minv = new Float64Array(m + 1).fill(Infinity);
        const used = new Uint8Array(m + 1);

        do {
            used[ j0 ] = 1;
            const i0 = owner[ j0 ];
            let delta = Infinity;
            let j1 = 0;

            for (let j = 1; j <= m; j++) {
                if (used[ j ]) continue;
                const current = cost[ i0 - 1 ][ j - 1 ] - u[ i0 ] - v[ j ];
                if (current < minv[ j ]) { minv[ j ] = current; way[ j ] = j0; }
                if (minv[ j ] < delta) { delta = minv[ j ]; j1 = j; }
            }

            for (let j = 0; j <= m; j++) {
                if (used[ j ]) { u[ owner[ j ] ] += delta; v[ j ] -= delta; }
                else minv[ j ] -= delta;
            }
            j0 = j1;
        } while (owner[ j0 ] !== 0);

        do {
            const j1 = way[ j0 ];
            owner[ j0 ] = owner[ j1 ];
            j0 = j1;
        } while (j0);
    }

    const result = new Array(n).fill(-1);
    for (let j = 1; j <= m; j++) {
        if (owner[ j ]) result[ owner[ j ] - 1 ] = j - 1;
    }
    return result;
}

module.exports = { hungarian };
