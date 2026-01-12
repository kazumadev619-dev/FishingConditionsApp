/*
  Warnings:

  - You are about to drop the `tide_cache` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `weather_cache` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "tide_cache" DROP CONSTRAINT "tide_cache_port_id_fkey";

-- DropForeignKey
ALTER TABLE "weather_cache" DROP CONSTRAINT "weather_cache_location_id_fkey";

-- DropTable
DROP TABLE "tide_cache";

-- DropTable
DROP TABLE "weather_cache";
