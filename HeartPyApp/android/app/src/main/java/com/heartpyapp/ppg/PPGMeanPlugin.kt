package com.heartpyapp.ppg

import android.media.Image
import com.mrousavy.camera.frameprocessors.Frame
import com.mrousavy.camera.frameprocessors.FrameProcessorPlugin
import com.mrousavy.camera.frameprocessors.FrameProcessorPluginRegistry
import java.nio.ByteBuffer

/**
 * Simple ROI mean-intensity plugin.
 *
 * Android fast-path uses Y (luma) plane from YUV_420 frame. This avoids color conversion.
 * Returns a Double (mean intensity 0..255) over a centered ROI.
 */
class PPGMeanPlugin : FrameProcessorPlugin() {
  override fun callback(frame: Frame, params: Map<String, Any?>?): Any? {
    return try {
      var roiIn = (params?.get("roi") as? Number)?.toFloat() ?: 0.4f
      // Clamp ROI to sane bounds
      var roi = roiIn.coerceIn(0.2f, 0.6f)

      val image = frame.image
      val planes = image.planes
      // Use plane 0 (Y plane) for mean intensity
      val yPlane = planes[0]
      val yBuffer: ByteBuffer = yPlane.buffer
      val rowStride = yPlane.rowStride
      val pixelStride = yPlane.pixelStride

      val width = frame.width
      val height = frame.height
      if (width <= 0 || height <= 0) return java.lang.Double.NaN

      var roiW = (width * roi).toInt().coerceAtLeast(1)
      var roiH = (height * roi).toInt().coerceAtLeast(1)

      // Area guard: ensure ROI covers at least 10% of frame
      val minArea = 0.1f * width.toFloat() * height.toFloat()
      if (roiW.toFloat() * roiH.toFloat() < minArea) {
        roi = 0.4f
        roiW = (width * roi).toInt().coerceAtLeast(1)
        roiH = (height * roi).toInt().coerceAtLeast(1)
      }

      val startX = ((width - roiW) / 2).coerceAtLeast(0)
      val startY = ((height - roiH) / 2).coerceAtLeast(0)

      var sum = 0L
      var count = 0L
      // Sample every 2 pixels for speed
      val xStep = 2
      val yStep = 2
      for (y in startY until (startY + roiH) step yStep) {
        val rowIndex = y * rowStride
        for (x in startX until (startX + roiW) step xStep) {
          // Absolute get() does not change buffer position
          val v: Int = yBuffer.get(rowIndex + x * pixelStride).toInt() and 0xFF
          sum += v
          count++
        }
      }
      if (count <= 0) java.lang.Double.NaN else sum.toDouble() / count.toDouble()
    } catch (t: Throwable) {
      java.lang.Double.NaN
    }
  }

  companion object Registrar {
    @JvmStatic
    fun register() {
      FrameProcessorPluginRegistry.addFrameProcessorPlugin("ppgMean") { _, _ ->
        PPGMeanPlugin()
      }
    }
  }
}
