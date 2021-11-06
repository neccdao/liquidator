type Token = {
    name: string;
    symbol: string;
    decimals: number;
    address: string;
    isWrapped?: boolean;
    isStable?: boolean;
};
export default function getPositionQuery(tokens: Token[]) {
    const collateralTokens = [];
    const indexTokens = [];
    const isLong = [];

    for (let i = 0; i < tokens.length; i++) {
        const token = tokens[i];
        collateralTokens.push(token.address);
        indexTokens.push(token.address);
        isLong.push(true);
    }

    for (let j = 0; j < tokens.length; j++) {
        const token = tokens[j];
        collateralTokens.push(token.address);
        indexTokens.push(token.address);
        isLong.push(false);
    }

    return { collateralTokens, indexTokens, isLong };
}
