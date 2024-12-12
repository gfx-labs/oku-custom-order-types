export class MainnetAddresses {
    // Tokens (ERC20)
    readonly tokens = {
        wethAddress: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
        wstethAddress: "0x7f39C581F595B53c5cb19bD0b3f8dA6c935E2Ca0",
        usdcAddress: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
        usdtAddress: "0xdAC17F958D2ee523a2206206994597C13D831ec7",
        compAddress: "0xc00e94cb662c3520282e6f5717214004a7f26888",
        wbtcAddress: "0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599",
        uniAddress: "0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984",
        ensAddress: "0xc18360217d8f7ab5e7c516566761ea12ce7f9d72",
        dydxAddress: "0x92d6c1e31e14520e676a687f0a93788b716beff5",
        aaveAddress: "0x7fc66500c84a76ad7e9c93437bfc5ac33e2ddae9",
        mkrAddress: "0x9f8F72aA9304c8B593d555F12eF6589cC3A579A2",
        tribeAddress: "0xc7283b66eb1eb5fb86327f08e1b5816b0720212b",
        polygonAddress: "0x7D1AfA7B718fb893dB30A3aBc0Cfc608AaCfeBB0",
        LDOaddress: "0x5A98FcBEA516Cf06857215779Fd812CA3beF1B32",
        balAddress: "0xba100000625a3754423978a60c9317c58a424e3D",
        rethAddress: "0xae78736Cd615f374D3085123A210448E74Fc6393",
        crvAddress: "0xD533A94974073B08e3809D4a66Ca925F7dad7c73",
        eignAddress: "0x5c49c3f6cb584bd298a8040b3219b10cd4654455",
        oneInchAddress: "0x111111111117dC0aa78b770fA79b7594669C6538",
        grtAddress: "0x6c6Bc977E13f9768b1e413c4B689A091D5a89009",
        snxAddress: "0xC011a73ee8578A9d51226C9A79FcF20b17b74B63",
        yfiAddress: "0x0bc529c00C6401aEF6D220BE8C6Ea1667F6Ad93e"
    };

    // Chainlink Feeds (Price Oracles)
    readonly chainlinkFeeds = {
        ethFeed: "0x5f4ec3df9cbd43714fe2740f5e3616155c5b8419",
        wstethFeed: "0x164b276057258d81941e97B0a900D4C7B358bCe0", 
        usdcFeed: "0x8fFfFfd4AfB6115b954Bd326cbe7B4BA576818f6",
        usdtFeed: "0x3E7d1eAB13ad0104d2750B8863b489D65364e32D",
        compFeed: "0xdbd020caef83efd542f4de03e3cf0c28a4428bd5",
        wbtcFeed: "0xf4030086522a5beea4988f8ca5b36dbc97bee88c",
        uniFeed: "0x553303d460EE0afB37EdFf9bE42922D8FF63220e",
        ensFeed: "0x5C00128d4d1c2F4f652C267d7bcdD7aC99C16E16", 
        dydxFeed: "", //no feed at all
        aaveFeed: "0x547a514d5e3769680Ce22B2361c10Ea13619e8a9",
        mkrFeed: "0xec1D1B3b0443256cc3860e24a46F108e699484Aa",
        tribeFeed: "", //no feed at all
        polygonFeed: "0x7bAC85A8a13A4BcD8abb3eB7d6b4d632c5a57676", 
        LDOFeed: "", //feed exists against eth only
        balFeed: "0xdF2917806E30300537aEB49A7663062F4d1F2b5F",
        rethFeed: "", //feed exists against eth only
        crvFeed: "0xCd627aA160A6fA45Eb793D19Ef54f5062F20f33f",
        eignFeed: "0xf2917e602C2dCa458937fad715bb1E465305A4A1",
        oneInchFeed: "0x72AFAECF99C9d9C8215fF44C77B94B99C28741e8",
        grtFeed: "0x86cF33a451dE9dc61a2862FD94FF4ad4Bd65A5d2",
        snxFeed: "0xDC3EA94CD0AC27d9A86C180091e7f78C683d3699",
        yfiFeed: "0xA027702dbb89fbd58938e4324ac03B58d812b0E1",
    };

    // Core Contract Deployments
    readonly coreDeployments = {
        master: "",
        bracket: "",
        stopLimit: "",
        oracleLess: "",
    };
    // Oracle Contract Deployments
    readonly oracleDeployments = {
        usdcOracle: "",
        wethOracle: "",
        usdtOracle: "",
    };
}
export class PolygonAddresses {
    readonly permit2: string = "0x000000000022D473030F116dDEE9F6B43aC78BA3";

    readonly tokens = {
        wethAddress: "0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619",
        wstethAddress: "0x03b54A6e9a984069379fae1a4fC4dBAE93B3bCCD",
        usdtAddress: "0xc2132D05D31c914a87C6611C10748AEb04B58e8F",
        usdcAddress: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359",
    };

    readonly clFeeds = {
        usdcFeed: "",
        wethFeed: "",
        usdtFeed: "",
    };

    readonly coreDeployments = {
        master: "",
        bracket: "",
        stopLimit: "",
        oracleLess: "",
    };

    readonly oracleDeployments = {
        usdcOracle: "",
        wethOracle: "",
        usdtOracle: "",
    };
}
export class ArbAddresses {
    readonly permit2: string = "0x000000000022D473030F116dDEE9F6B43aC78BA3";

    readonly tokens = {
        wethAddress: "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1",
        wstethAddress: "0x5979D7b546E38E414F7E9822514be443A4800529",
        usdtAddress: "0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9",
        nativeUsdcAddress: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
        bridgedUsdcAddress: "0xFF970A61A04b1cA14834A43f5dE4533eBDDB5CC8",
    };

    readonly clFeeds = {
        wethFeed: "0x639Fe6ab55C921f74e7fac1ee960C0B6293ba612",
        usdcFeed: "0x50834F3163758fcC1Df9973b6e91f0F0F0434aD3",
        usdtFeed: "0x3f3f5dF88dC9F13eac63DF89EC16ef6e7E25DdE7",
        //wstethFeed: "0xb523AE262D20A936BC152e6023996e46FDC2A95D"//wsteth/weth
    };

    readonly coreDeployments = {
        master: "",
        bracket: "",
        stopLimit: "",
        oracleLess: "",
    };

    readonly oracleDeployments = {
        usdcOracle: "0x9BDb5575E24EEb2DCA7Ba6CE367d609Bdeb38246",
        wethOracle: "0x384542D720A765aE399CFDDF079CBE515731F044",
        usdtOracle: "",
    };
}
export class BaseAddresses {
    readonly permit2: string = "0x000000000022D473030F116dDEE9F6B43aC78BA3";

    readonly tokens = {
        wethAddress: "0x4200000000000000000000000000000000000006",
        wstethAddress: "0xc1CBa3fCea344f92D9239c08C0568f6F2F0ee452",
        usdcAddress: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
        usdtAddress: "0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2",
    };

    readonly clFeeds = {
        wethFeed: "0x71041dddad3595F9CEd3DcCFBe3D1F4b0a16Bb70",
        usdcFeed: "0x7e860098F58bBFC8648a4311b374B1D669a2bc6B",
        usdtFeed: "0xf19d560eB8d2ADf07BD6D13ed03e1D11215721F9"
    };

    readonly coreDeployments = {
        master: "",
        bracket: "",
        stopLimit: "",
        oracleLess: "",
    };

    readonly oracleDeployments = {
        wethOracle: "0x45b265c7919D7FD8a0D673D7ACaA8F5A7abb430D",
        usdcOracle: "0xfA81b396270730dbd276D3Ee002B0B7ff68D86F8",
    };

}
export class BscAddresses {

    readonly permit2: string = ""

    readonly tokens = {
        wethAddress: "0x2170Ed0880ac9A755fd29B2688956BD959F933F8",
        usdcAddress: "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d",
        wstethAddress: "0x2Bbbdf97295F73175b12CC087cF446765931e1C3",
        usdtAddress: "0x55d398326f99059fF775485246999027B3197955",
    }

    readonly clFeeds = {
        usdcFeed: "0x51597f405303C4377E36123cBc172b13269EA163",
        wethFeed: "0x9ef1B8c0E4F7dc8bF5719Ea496883DC6401d5b2e",
        usdtFeed: "0xB97Ad0E74fa7d920791E90258A6E2085088b4320",
    };

    readonly coreDeployments = {
        master: "",
        bracket: "",
        stopLimit: "",
        oracleLess: "",
    };

    readonly oracleDeployments = {
        usdcOracle: "",
        wethOracle: "",
        usdtOracle: "",
    };


}
export class OptimisimAddresses {
    // Tokens
    readonly tokens = {
        wethAddress: "0x4200000000000000000000000000000000000006",
        opAddress: "0x4200000000000000000000000000000000000042",
        //usdcAddress: "0x7F5c764cBc14f9669B88837ca1490cCa17c31607",//depricated bridged usdc
        daiAddress: "0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1",
        wbtcAddress: "0x68f180fcCe6836688e9084f035309E29Bf0A2095",
        aaveAddress: "0x76FB31fb4af56892A25e32cFC43De717950c9278",
        uniAddress: "0x6fd9d7AD17242c41f7131d257212c54A0e816691",
        wstethAddress: "0x1F32b1c2345538c0c6f582fCB022739c4A194Ebb",
        rethAddress: "0x9Bcef72be871e61ED4fBbc7630889beE758eb81D",
        snxAddress: "0x8700dAec35aF8Ff88c16BdF0418774CB3D7599B4",
        usdtAddress: "0x94b008aA00579c1307B0EF2c499aD98a8ce58e58",
        pythAddress: "0x99C59ACeBFEF3BBFB7129DC90D1a11DB0E91187f",
        wldAddress: "0xdc6ff44d5d932cbd77b52e5612ba0529dc6226f1",
        ldoAddress: "0xfdb794692724153d1488ccdbe0c56c252596735f",
        pendleAddress: "0xbc7b1ff1c6989f006a1185318ed4e7b5796e66e1",
        fraxAddress: "0x2E3D870790dC77A83DD1d18184Acc7439A53f475",
        rplAddress: "0xC81D1F0EB955B0c020E5d5b264E1FF72c14d1401",
        yfiAddress: "0x9046d36440290ffde54fe0dd84db8b1cfee9107b",
        fxsAddress: "0x67CCEA5bb16181E7b4109c9c2143c24a1c2205Be",
        balAddress: "0xfe8b128ba8c78aabc59d4c64cee7ff28e9379921",
        kncAddress: "0xa00e3a3511aac35ca78530c85007afcd31753819",
        veloAddress: '0x9560e827aF36c94D2Ac33a39bCE1Fe78631088Db',
        usdcAddress: "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85"//native
    };

    // clFeeds
    readonly clFeeds = {
        wethFeed: "0x13e3ee699d1909e989722e753853ae30b17e08c5",
        wstethFeed: "0x698b585cbc4407e2d54aa898b2600b53c68958f7",
        rethFeed: "0x1a8F81c256aee9C640e14bB0453ce247ea0DFE6F",
        opFeed: "0x0d276fc14719f9292d5c1ea2198673d1f4269246",
        uniFeed: "0x11429ee838cc01071402f21c219870cbac0a59a0",
        aaveFeed: "0x338ed6787f463394d24813b297401b9f05a8c9d1",
        snxFeed: "0x2fcf37343e916eaed1f1ddaaf84458a359b53877",
        wbtcFeed: "0xD702DD976Fb76Fffc2D3963D037dfDae5b04E593",
        usdcFeed: "0x16a9FA2FDa030272Ce99B29CF780dFA30361E0f3",
        pythFeed: "0x0838cFe6A97C9CE1611a6Ed17252477a3c71eBEb",
        wldFeed: "0x4e1C6B168DCFD7758bC2Ab9d2865f1895813D236",
        ldoFeed: "0x221618871470f78D8a3391d35B77dFb3C0fbc383",
        pendleFeed: "0x58F23F80bF389DB1af9e3aA8c59679806749A8a4",
        fraxFeed: "0xc7D132BeCAbE7Dcc4204841F33bae45841e41D9C",
        rplFeed: "0xADE082c91A6AeCC86fC11704a830e933e1b382eA",
        yfiFeed: "0x5cdC797acCBf57EE2363Fed9701262Abc87a232e",
        fxsFeed: "0xB9B16330671067B1b062B9aC2eFd2dB75F03436E",
        balFeed: "0x30D9d31C1ac29Bc2c2c312c1bCa9F8b3D60e2376",
        kncFeed: "0xCB24d22aF35986aC1feb8874AdBbDF68f6dC2e96",
        veloFeed: "0x0f2Ed59657e391746C1a097BDa98F2aBb94b1120"
    };


    // oracleDeployments
    readonly oracleDeployments = {
        wethOracleAddress: "0x064E3A830f905686a718cb100708ff3D90aB5202",
        usdcOracleAddress: "0x8B5AbFbdC5Ec4B88A4e94afBf9f22b81F71a25a9",
        rethOracleAddress: "",
        wstethOracleAddress: "0x1792ea57b9DB08A077101999b309E951fe576792",
        opOracleAddress: "0xCBd011dACB8270E5235CB18b3b189Ff7d7fF5f28",
        wbtcOracleAddress: "0x210e8Ed0AaaF3A59FD2BD761b081F2B1c246c428",
        uniOracleAddress: "0x5B4784247dFCA5d0cB73E8ad46114eA3E65cF237",
        aaveOracleAddress: "0x1bfeb157400A05C010C34bfA0Baf89822D14a5e4",
        snxOracleAddress: "0x2DBe413536CBa5f4Eb832f94427Be980dDbAa0aa",
        pythOracleAddress: "0xe4f974b9DB33b9132709F2BadC0cf24954167FD2",
        wldOracleAddress: "0x588ede0BF90d9E883303b7F6F2f2814B5c129717",
        ldoOracleAddress: "0x7AC2e13d63bFE22DB4bf5aa0DaD2bC2C028b362F",
        pendleOracleAddress: "0x17781589c1088038652A4877bB0b170a1a37951F",
        fraxOracleAddress: "0xb1A9A0A5D4426A5Ce322639C9f4E8F27193e32A1",
        rplOracleAddress: "0xFB92D97223FEB34A0e33A1A4a439bAa1789D683D",
        yfiOracleAddress: "0x5aBB6d9735e7131f39F06A4AA7c789EBfC295241",
        fxsOracleAddress: "0x0c0337e0283d8547b54E15b0A5C5B2248Ff5FCE5",
        balOracleAddress: "0xe6daa90Bae9cAB1c171eefA561fF9b381ee5C19A",
        kncOracleAddress: "0x328397E6BcFFFFDebED68b3841283DEfb8C23807",
        veloOracleAddress: "0xFC8DBbC50dd144294D782D371F119a63229169fD"
    }

    readonly permit2: string = "0x000000000022D473030F116dDEE9F6B43aC78BA3"

}
export class ZkSyncAddresses {
    readonly permit2: string = ""

    readonly tokens = {
        wethAddress: "0xf00DAD97284D0c6F06dc4Db3c32454D4292c6813",
        usdcAddress: "0x1d17CBcF0D6D143135aE902365D2E5e2A16538D4",
        wstethAddress: "0xCafB42a2654C20cb3739F04243E925aa47302bec",
        usdtAddress: "0x493257fD37EDB34451f62EDf8D2a0C418852bA4C",
    }

    readonly clFeeds = {
        usdcFeed: "0x1824D297C6d6D311A204495277B63e943C2D376E",
        wethFeed: "0x6D41d1dc818112880b40e26BD6FD347E41008eDA",
        usdtFeed: "0xB615075979AE1836B476F651f1eB79f0Cd3956a9",
    };

    readonly coreDeployments = {
        master: "",
        bracket: "",
        stopLimit: "",
        oracleLess: "",
    };

    readonly oracleDeployments = {
        usdcOracle: "",
        wethOracle: "",
        usdtOracle: "",
    };
}
export class ScrollAddresses {
    readonly permit2: string = ""

    readonly tokens = {
        wethAddress: "0x5300000000000000000000000000000000000004",
        usdcAddress: "0x06eFdBFf2a14a7c8E15944D1F4A48F9F95F663A4",
        wstethAddress: "0xf610A9dfB7C89644979b4A0f27063E9e7d7Cda32",
        usdtAddress: "0xf55BEC9cafDbE8730f096Aa55dad6D22d44099Df",
    }

    readonly clFeeds = {
        usdcFeed: "0x43d12Fb3AfCAd5347fA764EeAB105478337b7200",
        wethFeed: "0x6bF14CB0A831078629D993FDeBcB182b21A8774C",
        usdtFeed: "0xf376A91Ae078927eb3686D6010a6f1482424954E",
    };

    readonly coreDeployments = {
        master: "",
        bracket: "",
        stopLimit: "",
        oracleLess: "",
    };

    readonly oracleDeployments = {
        usdcOracle: "",
        wethOracle: "",
        usdtOracle: "",
    };
}
export class FilecoinAddresses {
    readonly permit2: string = ""

    readonly tokens = {
        wethAddress: "f410fkivwc5k3l74bo2zjghnhx4nf7fau5nyqep3rtta",
        usdcAddress: "",
        wstethAddress: "",
        usdtAddress: "f410fiiuetm2vaon4ldzhqdgeqvert7e47l4upp6ugly",
    }

    readonly clFeeds = {
        usdcFeed: "",
        wethFeed: "",
        usdtFeed: "",
    };

    readonly coreDeployments = {
        master: "",
        bracket: "",
        stopLimit: "",
        oracleLess: "",
    };

    readonly oracleDeployments = {
        usdcOracle: "",
        wethOracle: "",
        usdtOracle: "",
    };
}
export class MoonbeamAddresses {
    readonly permit2: string = ""

    readonly tokens = {
        wethAddress: "0x30D2a9F5FDf90ACe8c17952cbb4eE48a55D916A7",
        usdcAddress: "0x8f552a71EFE5eeFc207Bf75485b356A0b3f01eC9",
        wstethAddress: "",
        usdtAddress: "0xeFAeeE334F0Fd1712f9a8cc375f427D9Cdd40d73",
    }

    readonly clFeeds = {
        usdcFeed: "0xA122591F60115D63421f66F752EF9f6e0bc73abC",
        wethFeed: "0x9ce2388a1696e22F870341C3FC1E89710C7569B5",
        usdtFeed: "0xD925C5BF88Bd0ca09312625d429240F811b437c6",
    };

    readonly coreDeployments = {
        master: "",
        bracket: "",
        stopLimit: "",
        oracleLess: "",
    };

    readonly oracleDeployments = {
        usdcOracle: "",
        wethOracle: "",
        usdtOracle: "",
    };
}
export class PolygonZkEvmAddresses {
    readonly permit2: string = ""

    readonly tokens = {
        wethAddress: "0x4F9A0e7FD2Bf6067db6994CF12E4495Df938E6e9",
        usdcAddress: "0xA8CE8aee21bC2A48a5EF670afCc9274C7bbbC035",
        wstethAddress: "0x5D8cfF95D7A57c0BF50B30b43c7CC0D52825D4a9",
        usdtAddress: "0x1E4a5963aBFD975d8c9021ce480b42188849D41d",
        wbtcAddress: "0xEA034fb02eB1808C2cc3adbC15f447B93CbE08e1"
    }

    readonly clFeeds = {
        usdcFeed: "0x0167D934CB7240e65c35e347F00Ca5b12567523a",
        wethFeed: "0x97d9F9A00dEE0004BE8ca0A8fa374d486567eE2D",
        usdtFeed: "0x8499f6E7D6Ac56C83f66206035D33bD1908a8b5D",
        wbtcFeed: "0xAE243804e1903BdbE26ae5f35bc6E4794Be21574"
    };

    readonly coreDeployments = {
        master: "",
        bracket: "",
        stopLimit: "",
        oracleLess: "",
    };

    readonly oracleDeployments = {
        usdcOracle: "",
        wethOracle: "",
        usdtOracle: "",
    };
}
export class BlastAddresses {
    readonly permit2: string = ""

    readonly tokens = {
        wethAddress: "0x4300000000000000000000000000000000000004",
        usdcAddress: "0xCdB5835bdb75c5B3671633d12d7E0DB6be5873A5",
        wstethAddress: "",
        usdtAddress: "0x0be9A0e280962213bF85C4F8669359291b2E404A",
    }

    readonly clFeeds = {
        usdcFeed: "",
        wethFeed: "",
        usdtFeed: "",
    };

    readonly coreDeployments = {
        master: "",
        bracket: "",
        stopLimit: "",
        oracleLess: "",
    };

    readonly oracleDeployments = {
        usdcOracle: "",
        wethOracle: "",
        usdtOracle: "",
    };
}
export class RootstockAddresses {
    readonly permit2: string = ""

    //https://rootstock.blockscout.com/tokens?sort=holder_count&order=desc
    readonly tokens = {
        wethAddress: "",
        usdcAddress: "",
        wstethAddress: "",
        usdtAddress: "",
        rifAddress: "0x2aCc95758f8b5F583470bA265Eb685a8f45fC9D5",
        sovAddress: "0xEfC78FC7D48B64958315949279bA181C2114abbD",
        rdocAddress: "0x2d919f19D4892381d58EdEbEcA66D5642ceF1A1F",
        usdrifAddress: "0x3A15461d8AE0f0Fb5fA2629e9dA7D66A794a6E37",
        rusdtAddress: "0xEf213441a85DF4d7acBdAe0Cf78004E1e486BB96"
    }

    readonly clFeeds = {
        usdcFeed: "",
        wethFeed: "",
        usdtFeed: "",
    };

    readonly coreDeployments = {
        master: "",
        bracket: "",
        stopLimit: "",
        oracleLess: "",
    };

    readonly oracleDeployments = {
        usdcOracle: "",
        wethOracle: "",
        usdtOracle: "",
    };
}
export class MantaPacificAddresses {
    readonly permit2: string = ""

    readonly tokens = {
        wethAddress: "0x0Dc808adcE2099A9F62AA87D9670745AbA741746",
        usdcAddress: "0xb73603C5d87fA094B7314C74ACE2e64D165016fb",
        wstethAddress: "0x2FE3AD97a60EB7c79A976FC18Bb5fFD07Dd94BA5",
        usdtAddress: "0xf417F5A458eC102B90352F697D6e2Ac3A3d2851f",
    }

    readonly clFeeds = {
        usdcFeed: "",
        wethFeed: "",
        usdtFeed: "",
    };

    readonly coreDeployments = {
        master: "",
        bracket: "",
        stopLimit: "",
        oracleLess: "",
    };

    readonly oracleDeployments = {
        usdcOracle: "",
        wethOracle: "",
        usdtOracle: "",
    };
}
export class BobaAddresses {
    readonly permit2: string = ""

    readonly tokens = {
        wethAddress: "0xdeaddeaddeaddeaddeaddeaddeaddeaddead0000",
        usdcAddress: "0x66a2A913e447d6b4BF33EFbec43aAeF87890FBbc",
        wstethAddress: "",
        usdtAddress: "0x5DE1677344D3Cb0D7D465c10b72A8f60699C062d",
        bobaAddress: "0xa18bF3994C0Cc6E3b63ac420308E5383f53120D7"
    }

    readonly clFeeds = {
        usdcFeed: "",
        wethFeed: "",
        usdtFeed: "",
    };

    readonly coreDeployments = {
        master: "",
        bracket: "",
        stopLimit: "",
        oracleLess: "",
    };

    readonly oracleDeployments = {
        usdcOracle: "",
        wethOracle: "",
        usdtOracle: "",
    };
}
export class LineaAddresses {
    readonly permit2: string = ""

    readonly tokens = {
        wethAddress: "0xe5D7C2a44FfDDf6b295A15c148167daaAf5Cf34f",
        usdcAddress: "0x176211869cA2b568f2A7D4EE941E073a821EE1ff",
        wstethAddress: "0xB5beDd42000b71FddE22D3eE8a79Bd49A568fC8F",
        usdtAddress: "0xA219439258ca9da29E9Cc4cE5596924745e12B93",
        wbtcAddress: "0x3aAB2285ddcDdaD8edf438C1bAB47e1a9D05a9b4"
    }

    readonly clFeeds = {
        usdcFeed: "0xAADAa473C1bDF7317ec07c915680Af29DeBfdCb5",
        wethFeed: "0x3c6Cd9Cc7c7a4c2Cf5a82734CD249D7D593354dA",
        usdtFeed: "0xefCA2bbe0EdD0E22b2e0d2F8248E99F4bEf4A7dB",
        wbtcFeed: "0x7A99092816C8BD5ec8ba229e3a6E6Da1E628E1F9"
    };

    readonly coreDeployments = {
        master: "",
        bracket: "",
        stopLimit: "",
        oracleLess: "",
    };

    readonly oracleDeployments = {
        usdcOracle: "",
        wethOracle: "",
        usdtOracle: "",
    };
}
export class TaikoAddresses {
    readonly permit2: string = ""

    readonly tokens = {
        wethAddress: "0xA51894664A773981C6C112C43ce576f315d5b1B6",
        usdcAddress: "0x07d83526730c7438048D55A4fc0b850e2aaB6f0b",
        wstethAddress: "",
        usdtAddress: "0x2DEF195713CF4a606B49D07E520e22C17899a736",
    }

    readonly clFeeds = {
        usdcFeed: "",
        wethFeed: "",
        usdtFeed: "",
    };

    readonly coreDeployments = {
        master: "",
        bracket: "",
        stopLimit: "",
        oracleLess: "",
    };

    readonly oracleDeployments = {
        usdcOracle: "",
        wethOracle: "",
        usdtOracle: "",
    };
}
export class SeiAddresses {
    readonly permit2: string = ""

    readonly tokens = {
        wethAddress: "",
        usdcAddress: "",
        wstethAddress: "",
        usdtAddress: "",
    }

    readonly clFeeds = {
        usdcFeed: "",
        wethFeed: "",
        usdtFeed: "",
    };

    readonly coreDeployments = {
        master: "",
        bracket: "",
        stopLimit: "",
        oracleLess: "",
    };

    readonly oracleDeployments = {
        usdcOracle: "",
        wethOracle: "",
        usdtOracle: "",
    };
}
export class GnosisAddresses {
    readonly permit2: string = ""

    readonly tokens = {
        wethAddress: "0x6A023CCd1ff6F2045C3309768eAd9E68F978f6e1",
        usdcAddress: "0x2a22f9c3b484c3629090FeED35F17Ff8F88f76F0",
        wstethAddress: "0x6C76971f98945AE98dD7d4DFcA8711ebea946eA6",
        usdtAddress: "0x4ECaBa5870353805a9F068101A40E0f32ed605C6",
    }

    readonly clFeeds = {
        usdcFeed: "0x26C31ac71010aF62E6B486D1132E266D6298857D",
        wethFeed: "0xa767f745331D267c7751297D982b050c93985627",
        usdtFeed: "0x68811D7DF835B1c33e6EEae8E7C141eF48d48cc7",
    };

    readonly coreDeployments = {
        master: "",
        bracket: "",
        stopLimit: "",
        oracleLess: "",
    };

    readonly oracleDeployments = {
        usdcOracle: "",
        wethOracle: "",
        usdtOracle: "",
    };
}
export class BobAddresses {
    readonly permit2: string = ""

    readonly tokens = {
        wethAddress: "0x4200000000000000000000000000000000000006",
        usdcAddress: "0xe75D0fB2C24A55cA1e3F96781a2bCC7bdba058F0",
        wstethAddress: "0x85008aE6198BC91aC0735CB5497CF125ddAAc528",
        usdtAddress: "0x05D032ac25d322df992303dCa074EE7392C117b9",
    }

    readonly clFeeds = {
        usdcFeed: "",
        wethFeed: "",
        usdtFeed: "",
    };

    readonly coreDeployments = {
        master: "",
        bracket: "",
        stopLimit: "",
        oracleLess: "",
    };

    readonly oracleDeployments = {
        usdcOracle: "",
        wethOracle: "",
        usdtOracle: "",
    };
}
export class XLayerAddresses {
    readonly permit2: string = ""

    readonly tokens = {
        wethAddress: "0x5a77f1443d16ee5761d310e38b62f77f726bc71c",
        usdcAddress: "0x74b7f16337b8972027f6196a17a631ac6de26d22",
        wstethAddress: "",
        usdtAddress: "0x1e4a5963abfd975d8c9021ce480b42188849d41d",
    }

    readonly clFeeds = {
        usdcFeed: "",
        wethFeed: "",
        usdtFeed: "",
    };

    readonly coreDeployments = {
        master: "",
        bracket: "",
        stopLimit: "",
        oracleLess: "",
    };

    readonly oracleDeployments = {
        usdcOracle: "",
        wethOracle: "",
        usdtOracle: "",
    };
}
export class Metall2Addresses {
    readonly permit2: string = ""

    readonly tokens = {
        wethAddress: "0x4200000000000000000000000000000000000006",
        usdcAddress: "0xb91CFCcA485C6E40E3bC622f9BFA02a8ACdEeBab",//usdc
        bridgedUsdcAddress: "0x51E85d70944256710cb141847F1a04f568C1Db0e",//usdc.e
        wstethAddress: "",
        usdtAddress: "",
        metalAddress: "0xBCFc435d8F276585f6431Fc1b9EE9A850B5C00A9"
    }

    readonly clFeeds = {
        usdcFeed: "",
        wethFeed: "",
        usdtFeed: "",
    };

    readonly coreDeployments = {
        master: "",
        bracket: "",
        stopLimit: "",
        oracleLess: "",
    };

    readonly oracleDeployments = {
        usdcOracle: "",
        wethOracle: "",
        usdtOracle: "",
    };
}
export class template {
    readonly permit2: string = ""

    readonly tokens = {
        wethAddress: "",
        usdcAddress: "",
        wstethAddress: "",
        usdtAddress: "",
    }

    readonly clFeeds = {
        usdcFeed: "",
        wethFeed: "",
        usdtFeed: "",
    };

    readonly coreDeployments = {
        master: "",
        bracket: "",
        stopLimit: "",
        oracleLess: "",
    };

    readonly oracleDeployments = {
        usdcOracle: "",
        wethOracle: "",
        usdtOracle: "",
    };
}

// Function to retrieve the addresses by chain ID
export function getAddressesByChainId(chainId: number) {
    const addresses = chainIdToAddresses[chainId];
    if (!addresses) {
        throw new Error(`Addresses not available for chain ID ${chainId}`);
    }
    return addresses;
}

const chainIdToAddresses: Record<number, any> = {
    1: new MainnetAddresses(),
    42161: new ArbAddresses(),
    137: new PolygonAddresses(),
    10: new OptimisimAddresses(),
    8453: new BaseAddresses(),
    56: new BscAddresses(),
    324: new ZkSyncAddresses(),
    534353: new ScrollAddresses(),
    314: new FilecoinAddresses(),  // Filecoin
    1284: new MoonbeamAddresses(), // Moonbeam
    1101: new PolygonZkEvmAddresses(), // Polygon zkEVM
    81457: new BlastAddresses(), // Blast
    30: new RootstockAddresses(), // Rootstock
    169: new MantaPacificAddresses(), // Manta Pacific
    288: new BobaAddresses(), // Boba
    59144: new LineaAddresses(), // Linea
    167000: new TaikoAddresses(), // Taiko
    15000: new SeiAddresses(), // Sei
    100: new GnosisAddresses(), // Gnosis
    1294: new BobAddresses(), // Bob
    2025: new XLayerAddresses(), // XLayer
    1750: new Metall2Addresses() // Metall2
};
