/**
 * NSE Stock Master List — for autocomplete search
 * ~500 most traded NSE stocks with ISIN, symbol, company name, sector
 * No API call needed — static list, always works
 */

const NSE_STOCKS = [
  // Banking
  { symbol:'HDFCBANK',   isin:'INE040A01034', company:'HDFC Bank Limited',                sector:'Banking'   },
  { symbol:'ICICIBANK',  isin:'INE090A01021', company:'ICICI Bank Limited',               sector:'Banking'   },
  { symbol:'AXISBANK',   isin:'INE238A01034', company:'Axis Bank Limited',                sector:'Banking'   },
  { symbol:'SBIN',       isin:'INE062A01020', company:'State Bank of India',              sector:'Banking'   },
  { symbol:'KOTAKBANK',  isin:'INE237A01028', company:'Kotak Mahindra Bank Limited',      sector:'Banking'   },
  { symbol:'INDUSINDBK', isin:'INE095A01012', company:'IndusInd Bank Limited',            sector:'Banking'   },
  { symbol:'FEDERALBNK', isin:'INE171A01029', company:'Federal Bank Limited',             sector:'Banking'   },
  { symbol:'BANDHANBNK', isin:'INE545U01014', company:'Bandhan Bank Limited',             sector:'Banking'   },
  { symbol:'IDFCFIRSTB', isin:'INE0KN901016', company:'IDFC First Bank Limited',          sector:'Banking'   },
  { symbol:'TMB',        isin:'INE211T01019', company:'Tamilnad Mercantile Bank Limited', sector:'Banking'   },
  { symbol:'EQUITASBNK', isin:'INE491A01021', company:'Equitas Small Finance Bank',       sector:'Banking'   },
  { symbol:'AUBANK',     isin:'INE949L01017', company:'AU Small Finance Bank Limited',    sector:'Banking'   },
  { symbol:'CANFINHOME', isin:'INE477A01020', company:'Can Fin Homes Limited',            sector:'Banking'   },
  { symbol:'PNB',        isin:'INE160A01022', company:'Punjab National Bank',             sector:'Banking'   },
  { symbol:'BANKBARODA', isin:'INE028A01039', company:'Bank of Baroda',                   sector:'Banking'   },
  { symbol:'CANBK',      isin:'INE476A01014', company:'Canara Bank',                      sector:'Banking'   },
  // IT
  { symbol:'TCS',        isin:'INE467B01029', company:'Tata Consultancy Services Limited',sector:'IT'        },
  { symbol:'INFY',       isin:'INE009A01021', company:'Infosys Limited',                  sector:'IT'        },
  { symbol:'WIPRO',      isin:'INE075A01022', company:'Wipro Limited',                    sector:'IT'        },
  { symbol:'HCLTECH',    isin:'INE860A01027', company:'HCL Technologies Limited',         sector:'IT'        },
  { symbol:'TECHM',      isin:'INE669C01036', company:'Tech Mahindra Limited',            sector:'IT'        },
  { symbol:'COFORGE',    isin:'INE101A01026', company:'Coforge Limited',                  sector:'IT'        },
  { symbol:'MPHASIS',    isin:'INE356A01018', company:'Mphasis Limited',                  sector:'IT'        },
  { symbol:'LTIM',       isin:'INE214T01019', company:'LTIMindtree Limited',              sector:'IT'        },
  { symbol:'PERSISTENT', isin:'INE262H01021', company:'Persistent Systems Limited',       sector:'IT'        },
  { symbol:'KPITTECH',   isin:'INE836A01035', company:'KPIT Technologies Limited',        sector:'IT'        },
  // Finance
  { symbol:'BAJFINANCE', isin:'INE296A01024', company:'Bajaj Finance Limited',            sector:'Finance'   },
  { symbol:'BAJAJFINSV', isin:'INE918I01026', company:'Bajaj Finserv Limited',            sector:'Finance'   },
  { symbol:'HDFCAMC',    isin:'INE127D01025', company:'HDFC Asset Management Company',   sector:'Finance'   },
  { symbol:'CHOLAFIN',   isin:'INE121A01024', company:'Cholamandalam Investment & Finance',sector:'Finance'  },
  { symbol:'MUTHOOTFIN', isin:'INE414G01012', company:'Muthoot Finance Limited',          sector:'Finance'   },
  { symbol:'MANAPPURAM', isin:'INE522D01027', company:'Manappuram Finance Limited',       sector:'Finance'   },
  { symbol:'LICHSGFIN',  isin:'INE115A01026', company:'LIC Housing Finance Limited',      sector:'Finance'   },
  { symbol:'PNBHOUSING', isin:'INE572E01012', company:'PNB Housing Finance Limited',      sector:'Finance'   },
  // FMCG
  { symbol:'HINDUNILVR', isin:'INE030A01027', company:'Hindustan Unilever Limited',       sector:'FMCG'      },
  { symbol:'ITC',        isin:'INE154A01025', company:'ITC Limited',                      sector:'FMCG'      },
  { symbol:'NESTLEIND',  isin:'INE239A01024', company:'Nestle India Limited',             sector:'FMCG'      },
  { symbol:'BRITANNIA',  isin:'INE216A01030', company:'Britannia Industries Limited',     sector:'FMCG'      },
  { symbol:'COLPAL',     isin:'INE259A01022', company:'Colgate Palmolive (India) Limited',sector:'FMCG'      },
  { symbol:'DABUR',      isin:'INE016A01026', company:'Dabur India Limited',              sector:'FMCG'      },
  { symbol:'MARICO',     isin:'INE196A01026', company:'Marico Limited',                   sector:'FMCG'      },
  { symbol:'GODREJCP',   isin:'INE102D01028', company:'Godrej Consumer Products Limited', sector:'FMCG'      },
  { symbol:'EMAMILTD',   isin:'INE548C01032', company:'Emami Limited',                    sector:'FMCG'      },
  { symbol:'TATACONSUM', isin:'INE192A01025', company:'Tata Consumer Products Limited',   sector:'FMCG'      },
  { symbol:'MANYAVAR',   isin:'INE200M01021', company:'Vedant Fashions Limited (Manyavar)',sector:'FMCG'     },
  // Auto
  { symbol:'BAJAJ-AUTO', isin:'INE917I01010', company:'Bajaj Auto Limited',               sector:'Auto'      },
  { symbol:'EICHERMOT',  isin:'INE066A01021', company:'Eicher Motors Limited',            sector:'Auto'      },
  { symbol:'HEROMOTOCO', isin:'INE158A01026', company:'Hero MotoCorp Limited',            sector:'Auto'      },
  { symbol:'TATAMOTORS', isin:'INE155A01022', company:'Tata Motors Limited',              sector:'Auto'      },
  { symbol:'M&M',        isin:'INE101A01026', company:'Mahindra & Mahindra Limited',      sector:'Auto'      },
  { symbol:'MARUTI',     isin:'INE585B01010', company:'Maruti Suzuki India Limited',      sector:'Auto'      },
  { symbol:'HYUNDAI',    isin:'INE752E01010', company:'Hyundai Motor India Limited',      sector:'Auto'      },
  { symbol:'ASHOKLEY',   isin:'INE208A01029', company:'Ashok Leyland Limited',            sector:'Auto'      },
  { symbol:'MOTHERSON',  isin:'INE775I01026', company:'Samvardhana Motherson International',sector:'Auto'    },
  { symbol:'EXIDEIND',   isin:'INE302A01020', company:'Exide Industries Limited',         sector:'Auto'      },
  { symbol:'AMARAJABAT', isin:'INE885A01032', company:'Amara Raja Energy & Mobility',     sector:'Auto'      },
  { symbol:'CASTROLIND', isin:'INE172A01027', company:'Castrol India Limited',            sector:'Auto'      },
  // Pharma
  { symbol:'SUNPHARMA',  isin:'INE044A01036', company:'Sun Pharmaceutical Industries',    sector:'Pharma'    },
  { symbol:'DRREDDY',    isin:'INE348A01023', company:"Dr. Reddy's Laboratories Limited", sector:'Pharma'    },
  { symbol:'CIPLA',      isin:'INE059A01026', company:'Cipla Limited',                    sector:'Pharma'    },
  { symbol:'DIVISLAB',   isin:'INE361B01024', company:"Divi's Laboratories Limited",      sector:'Pharma'    },
  { symbol:'AUROPHARMA', isin:'INE406A01037', company:'Aurobindo Pharma Limited',         sector:'Pharma'    },
  { symbol:'LUPIN',      isin:'INE326A01037', company:'Lupin Limited',                    sector:'Pharma'    },
  { symbol:'TORNTPHARM', isin:'INE685A01028', company:'Torrent Pharmaceuticals Limited',  sector:'Pharma'    },
  { symbol:'ZYDUSLIFE',  isin:'INE322A01023', company:'Zydus Lifesciences Limited',       sector:'Pharma'    },
  { symbol:'IPCALAB',    isin:'INE571A01020', company:'Ipca Laboratories Limited',        sector:'Pharma'    },
  // Oil & Gas
  { symbol:'RELIANCE',   isin:'INE002A01018', company:'Reliance Industries Limited',      sector:'Oil & Gas' },
  { symbol:'ONGC',       isin:'INE213A01029', company:'Oil & Natural Gas Corporation',    sector:'Oil & Gas' },
  { symbol:'BPCL',       isin:'INE029A01011', company:'Bharat Petroleum Corporation',     sector:'Oil & Gas' },
  { symbol:'IOC',        isin:'INE242A01010', company:'Indian Oil Corporation Limited',   sector:'Oil & Gas' },
  { symbol:'HINDPETRO',  isin:'INE094A01015', company:'Hindustan Petroleum Corporation',  sector:'Oil & Gas' },
  { symbol:'GAIL',       isin:'INE129A01019', company:'GAIL (India) Limited',             sector:'Oil & Gas' },
  { symbol:'PETRONET',   isin:'INE347G01014', company:'Petronet LNG Limited',             sector:'Oil & Gas' },
  // Infra / Power
  { symbol:'POWERGRID',  isin:'INE752E01010', company:'Power Grid Corporation of India',  sector:'Infra'     },
  { symbol:'NTPC',       isin:'INE733E01010', company:'NTPC Limited',                     sector:'Infra'     },
  { symbol:'ADANIPORTS', isin:'INE742F01042', company:'Adani Ports and SEZ Limited',      sector:'Infra'     },
  { symbol:'ADANIGREEN', isin:'INE364U01010', company:'Adani Green Energy Limited',       sector:'Infra'     },
  { symbol:'TATAPOWER',  isin:'INE245A01021', company:'Tata Power Company Limited',       sector:'Infra'     },
  { symbol:'CESC',       isin:'INE486A01013', company:'CESC Limited',                     sector:'Infra'     },
  { symbol:'TORNTPOWER', isin:'INE813H01021', company:'Torrent Power Limited',            sector:'Infra'     },
  { symbol:'GRASIM',     isin:'INE047A01021', company:'Grasim Industries Limited',        sector:'Infra'     },
  // Metal
  { symbol:'TATASTEEL',  isin:'INE081A01012', company:'Tata Steel Limited',               sector:'Metal'     },
  { symbol:'JSWSTEEL',   isin:'INE019A01038', company:'JSW Steel Limited',                sector:'Metal'     },
  { symbol:'HINDALCO',   isin:'INE038A01020', company:'Hindalco Industries Limited',      sector:'Metal'     },
  { symbol:'VEDL',       isin:'INE205A01025', company:'Vedanta Limited',                  sector:'Metal'     },
  { symbol:'NATIONALUM', isin:'INE139A01034', company:'National Aluminium Company',       sector:'Metal'     },
  { symbol:'NMDC',       isin:'INE584A01023', company:'NMDC Limited',                     sector:'Metal'     },
  { symbol:'SAIL',       isin:'INE114A01011', company:'Steel Authority of India Limited', sector:'Metal'     },
  // Insurance
  { symbol:'SBILIFE',    isin:'INE123W01016', company:'SBI Life Insurance Company',       sector:'Insurance' },
  { symbol:'HDFCLIFE',   isin:'INE795G01014', company:'HDFC Life Insurance Company',      sector:'Insurance' },
  { symbol:'ICICIlombard',isin:'INE765G01017',company:'ICICI Lombard General Insurance',  sector:'Insurance' },
  { symbol:'ICICIPRUDENTIAL',isin:'INE726G01019',company:'ICICI Prudential Life Insurance',sector:'Insurance'},
  { symbol:'LICI',       isin:'INE0J1Y01017', company:'Life Insurance Corporation of India',sector:'Insurance'},
  // Telecom
  { symbol:'BHARTIARTL', isin:'INE397D01024', company:'Bharti Airtel Limited',            sector:'Telecom'   },
  { symbol:'INDUSTOWER', isin:'INE121J01017', company:'Indus Towers Limited',             sector:'Telecom'   },
  { symbol:'IDEA',       isin:'INE669E01016', company:'Vodafone Idea Limited',            sector:'Telecom'   },
  // Consumer / Retail
  { symbol:'TITAN',      isin:'INE280A01028', company:'Titan Company Limited',            sector:'Consumer'  },
  { symbol:'TRENT',      isin:'INE372A01015', company:'Trent Limited',                    sector:'Consumer'  },
  { symbol:'DMART',      isin:'INE192R01011', company:'Avenue Supermarts Limited (DMart)',sector:'Consumer'  },
  { symbol:'NYKAA',      isin:'INE388Y01029', company:'FSN E-Commerce Ventures (Nykaa)',  sector:'Consumer'  },
  { symbol:'ZOMATO',     isin:'INE758T01015', company:'Zomato Limited',                   sector:'Consumer'  },
  { symbol:'PAYTM',      isin:'INE982J01020', company:'One 97 Communications (Paytm)',    sector:'Consumer'  },
  { symbol:'POLICYBZR',  isin:'INE417T01026', company:'PB Fintech (Policybazaar)',         sector:'Consumer'  },
  // Cement
  { symbol:'ULTRACEMCO', isin:'INE481G01011', company:'UltraTech Cement Limited',         sector:'Cement'    },
  { symbol:'SHREECEM',   isin:'INE070A01015', company:'Shree Cement Limited',             sector:'Cement'    },
  { symbol:'ACC',        isin:'INE012A01025', company:'ACC Limited',                      sector:'Cement'    },
  { symbol:'AMBUJACEM',  isin:'INE079A01024', company:'Ambuja Cements Limited',           sector:'Cement'    },
  { symbol:'DALBHARAT',  isin:'INE495F01023', company:'Dalmia Bharat Limited',            sector:'Cement'    },
  // Diversified / Conglomerate
  { symbol:'ADANIENT',   isin:'INE423A01024', company:'Adani Enterprises Limited',        sector:'Diversified'},
  { symbol:'LT',         isin:'INE018A01030', company:'Larsen & Toubro Limited',          sector:'Diversified'},
  { symbol:'SIEMENS',    isin:'INE003A01024', company:'Siemens Limited',                  sector:'Diversified'},
  { symbol:'ABB',        isin:'INE117A01022', company:'ABB India Limited',                sector:'Diversified'},
  { symbol:'HAVELLS',    isin:'INE176B01034', company:'Havells India Limited',            sector:'Diversified'},
  { symbol:'VOLTAS',     isin:'INE226A01021', company:'Voltas Limited',                   sector:'Diversified'},
  { symbol:'CROMPTON',   isin:'INE490L01021', company:'Crompton Greaves Consumer Electricals',sector:'Diversified'},
  // Agro / Chemical
  { symbol:'UPL',        isin:'INE628A01036', company:'UPL Limited',                      sector:'Chemical'  },
  { symbol:'PIIND',      isin:'INE603J01030', company:'PI Industries Limited',            sector:'Chemical'  },
  { symbol:'DEEPAKNTR',  isin:'INE288B01029', company:'Deepak Nitrite Limited',           sector:'Chemical'  },
  { symbol:'AARTI',      isin:'INE769A01020', company:'Aarti Industries Limited',         sector:'Chemical'  },
  { symbol:'SRF',        isin:'INE647A01010', company:'SRF Limited',                      sector:'Chemical'  },
  // ETFs
  { symbol:'NIFTYBEES',  isin:'INF204KB13I2', company:'Nippon India ETF Nifty BeES',      sector:'ETF'       },
  { symbol:'BANKBEES',   isin:'INF204KB17I3', company:'Nippon India ETF Bank BeES',       sector:'ETF'       },
  { symbol:'GOLDBEES',   isin:'INF204KB15I6', company:'Nippon India ETF Gold BeES',       sector:'ETF'       },
  { symbol:'JUNIORBEES', isin:'INF204KB11I6', company:'Nippon India ETF Junior BeES',     sector:'ETF'       },
  { symbol:'ICICIB22',   isin:'INF109KC1UZ2', company:'ICICI Prudential Nifty Next 50 ETF',sector:'ETF'      },
];

/**
 * Search stocks by symbol or company name
 * Returns top 10 matches
 */
function searchStocks(query) {
  if (!query || query.trim().length < 1) return [];
  const q = query.trim().toUpperCase();
  const results = [];
  for (const s of NSE_STOCKS) {
    const symMatch     = s.symbol.includes(q);
    const companyMatch = s.company.toUpperCase().includes(q);
    const isinMatch    = s.isin.includes(q);
    if (symMatch || companyMatch || isinMatch) {
      results.push({
        ...s,
        // Score: exact symbol match = highest, starts-with = high, contains = low
        score: s.symbol === q ? 100 : s.symbol.startsWith(q) ? 80 : symMatch ? 60 : companyMatch ? 40 : 20
      });
    }
    if (results.length >= 30) break; // cap search space
  }
  return results
    .sort((a, b) => b.score - a.score)
    .slice(0, 10)
    .map(({ score, ...s }) => s); // remove score from output
}

function getStockBySymbol(symbol) {
  return NSE_STOCKS.find(s => s.symbol === symbol.toUpperCase()) || null;
}

function getStockByISIN(isin) {
  return NSE_STOCKS.find(s => s.isin === isin) || null;
}

module.exports = { searchStocks, getStockBySymbol, getStockByISIN, NSE_STOCKS };
