const convert = require('xml-to-json-promise')
const request = require('request-promise')
const fs = require('fs.promised')
const mongo = require('mongodb').MongoClient

const url = 'mongodb://localhost/excursions'



Array.prototype.distinct = function () {
  return [...new Set(this)]
}

const parseMappingFile = (fileName) => {
  const mapHotel = xml => ({
    cmdCode: xml.Cod_CMD[0].trim(),
  })

  const mapService = xml => ({
    serviceCode: xml.Cod_Service[0],
    factsheetCode: xml.Cod_Factsheet[0],
    hotels: xml.Hotels[0].Hotel_Asterix.map(mapHotel),
  })

  return convert.xmlFileToJSON(fileName)
    .then(x => x.xml.Destino[0].Service)
    .then(x => x.map(mapService))
}

const parseMappingFiles = filePath =>
  fs.readdir(filePath)
    .then(x => x.map(y => parseMappingFile(filePath + y)))
    .then(x => Promise.all(x))
    .then(x => x.reduce((arr, y) => arr.concat(y), []))

const parseContentFile = (fileName) => {
  const mapDescriptions = (descriptions) => {
    const mappedDescriptions = descriptions.reduce((o, x) => {
      o[x.$.type] = x._.trim()
      return o
    }, {})

    return {
      short: mappedDescriptions.ShortDescription,
      general: mappedDescriptions.GeneralDescription,
      additional: mappedDescriptions.AdditionalDescription,
      toolTip: mappedDescriptions.ToolTipDescription,
    }
  }

  const mapCategory = (segmentGroups) => {
    const segments = segmentGroups.reduce((o, x) => {
      o[x.$.id] = x.Segment[0].Name[0].trim()
      return o
    }, {})

    return {
      name: segments['9'],
    }
  }

  const mapContent = xml => ({
    name: xml.TicketInfo.Name[0].trim(),
    factsheetCode: xml.TicketInfo.Code[0],
    description: mapDescriptions(xml.TicketInfo.DescriptionList[0].Description),
    category: mapCategory(xml.TicketInfo.Segmentation[0].SegmentationGroup),
  })

  return convert.xmlFileToJSON(fileName)
    .then(mapContent)
    .catch(() => null)
}

const getGeoHierarchy = () => {
  const url = 'http://api.fritidsresor.se/meta/enoktpgmapping/'

  return request(url)
    .then(x => JSON.parse(x))
    .catch(x => console.log(x))
}

const getTpgId = (cmdCode) => {
  if (cmdCode === '') {
    return Promise.resolve({
      cmdCode,
      tpgId: null,
    })
  }

  const url = `http://services.acce.tuinordic.insite/xrs/sys/CMD/CommonAccommodation/${cmdCode}/AP`

  return request(url)
    .then(x => ({
      cmdCode,
      tpgId: x.trim(),
    }))
    .catch(() => ({
      cmdCode,
      tpgId: null,
    }))
}

const getTpgIds = cmdCodes =>
  Promise.all(cmdCodes.map(x => getTpgId(x)))

const getCmdCodes = services =>
  services
    .map(y => y.hotels)
    .reduce((z, y) => z.concat(y), [])
    .map(y => y.cmdCode)
    .distinct()

const addTpgIdToHotels = (services, tpgMappings) => {
  const mappings = new Map()

  for (const mapping of tpgMappings) {
    mappings.set(mapping.cmdCode, mapping.tpgId)
  }

  for (const service of services) {
    for (const hotel of service.hotels) {
      hotel.tpgId = mappings.get(hotel.cmdCode)
    }
  }
}

const addGeoStructureToHotels = (excursions, geoHierarchy) => {
  const indexedGeo = new Map()

  for (const item of geoHierarchy.items) {
    indexedGeo.set(item.id, item)
  }

  for (const excursion of excursions) {
    const resorts = new Set()
    const destinations = new Set()
    const accommodationProducts = new Set()

    for (const hotel of excursion.hotels) {
      if (hotel.tpgId === null) {
        continue
      }

      accommodationProducts.add(hotel.tpgId)
      const geoItem = indexedGeo.get(hotel.tpgId)

      if (geoItem === undefined || geoItem === null) {
        continue
      }
      const geoStructure = geoItem.geoStructure

      if (geoStructure.resort !== null) {
        resorts.add(geoStructure.resort.id)
      }

      if (geoStructure.destination !== null) {
        destinations.add(geoStructure.destination.id)
      }
    }
    const mapGeo = geoItem => ({ id: geoItem.id, name: geoItem.name })
    const getGeoItems = arr => Array.from(arr)
      .map(x => indexedGeo.get(x))
      .filter(x => x !== undefined)
      .map(mapGeo)
    excursion.resorts = getGeoItems(resorts)
    excursion.destinations = getGeoItems(destinations)
    excursion.accommodationProducts = getGeoItems(accommodationProducts)
  }
}

const addContentToExcursions = (excursions, contentFiles) => {
  for (const content of contentFiles) {
    if (content === null) {
      continue
    }

    const excursion = excursions.find(x => x.factsheetCode === content.factsheetCode)

    if (excursion === null && excursion === undefined) {
      continue
    }

    Object.assign(excursion, content)
  }
}

const getContentFileName = service =>
  `D:\\Temp\\excursions\\structure2\\content-folder\\${service.factsheetCode}_SUE.xml`

const main = () => {
  const excursions = parseMappingFiles('D:\\Temp\\excursions\\structure2\\aux-folder\\')

  const cmdTpgMappings = excursions
    .then(getCmdCodes)
    .then(getTpgIds)

  const geo = getGeoHierarchy()

  const contentPromises = excursions
    .then(x => x.map(getContentFileName).map(parseContentFile))
    .then(x => Promise.all(x))

  Promise.all([excursions, cmdTpgMappings, geo, contentPromises])
    .then(([s, m, g, c]) => {
      for (const excursion of s) {
        excursion['_id'] = excursion.factsheetCode
      }

      addTpgIdToHotels(s, m)
      addContentToExcursions(s, c)
      addGeoStructureToHotels(s, g)

      for (const excursion of s) {
        delete excursion.factsheetCode
        delete excursion.hotels
        delete excursion.serviceCode
      }

      mongo.connect(url, (err, db) => {
        const excursionsCollection = db.collection('excursions')
        const batch = excursionsCollection.initializeUnorderedBulkOp()

        for (const excursion of s) {
          batch.find({ _id: excursion['_id'] }).upsert().updateOne(excursion)
        }

        batch.execute((dberr) => {
          if (dberr !== null) {
            console.dir(dberr)
          }

          db.close()
        })
      })
    })
    .catch(x => console.dir(x))
}

main()