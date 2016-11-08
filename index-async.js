const fs = require("fs.promised")
const xml2js = require('xml2js');
const convert = require('xml-to-json-promise')
const request = require('request-promise')

const doSomething_ES2016 = async function () {
  let file = await fs.readFile("D:\\Dev\\OLE\\root\\auxfiles\\AUX_ASX-37863.xml")

  let json = await xml2json(file);
  let services = json.xml.Destino[0].Service;
  let mappedServices = getServices(services)
  let uniqHotels = getUniqueHotels(mappedServices)

  let arr = await getTpgIds(uniqHotels)
  console.log(arr)
  let lala = "";

}

async function getTpgIds(cmdCodes) {
  let arr = []
  const a = await Promise.all(cmdCodes.map(async (code) => {
    const contents = await getTpgId(code)
    arr.push(contents)
  }));
  return arr;
}

async function getTpgId(cmdCode) {
  return new Promise((resolve, reject) => {
    const url = `http://services.acce.tuinordic.insite/xrs/sys/CMD/CommonAccommodation/${cmdCode}/AP`

    return request(url)
      .then(x => resolve({ // <-- resolve
        cmdCode,
        tpgId: x,
      }))
      .catch(_ => resolve({ // <-- resolve
        cmdCode,
        tpgId: null,
      }))
  })
}



function getUniqueHotels(mappedServices) {
  return [...new Set(mappedServices
    .map(y => y.hotels)
    .reduce((z, y) => z.concat(y), [])
    .map(y => y.cmdCode))]
}

function getServices(services) {
  return services.map(x => {
    return {
      serviceCode: x.Cod_Service[0],
      factsheetCode: x.Cod_Factsheet[0],
      hotels: x.Hotels[0].Hotel_Asterix
        .map(y => { return { cmdCode: y.Cod_CMD[0] } })
    }
  })

}

async function xml2json(xml) {
  return new Promise((resolve, reject) => {
    xml2js.parseString(xml, function (err, json) {
      if (err)
        reject(err);
      else
        resolve(json);
    });
  });
}
doSomething_ES2016();